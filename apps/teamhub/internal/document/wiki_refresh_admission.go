package document

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// admitWikiRefresh runs admit as one Human's Wiki refresh admission and
// retries it after a serialization failure.
//
// Admission runs in REPEATABLE READ under the Human's admission lock, taken
// before the transaction starts so that each snapshot already holds the
// previous admission's commit. Admissions of different Humans write different
// rows but share pages of small indexes, such as the one active refresh per
// Wiki, so SERIALIZABLE predicate locks aborted them against each other.
// Within one Human the lock orders admissions, and settlement and dispatch
// update the Wiki and refresh rows admission locks, so they surface as write
// conflicts that retry on a fresh snapshot.
func (s *Service) admitWikiRefresh(ctx context.Context, tenantID, accountID string, admit func(pgx.Tx) error) error {
	key := "wiki-refresh-admission|" + tenantID + "|" + accountID
	connection, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	queries := store.New(connection)
	if err := queries.AcquireAdvisorySessionLock(ctx, key); err != nil {
		discardPoolConnection(connection)
		return err
	}
	defer func() {
		unlockContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if unlocked, err := queries.ReleaseAdvisorySessionLock(unlockContext, key); err != nil || !unlocked {
			// A session that may still hold the lock must not return to the pool.
			discardPoolConnection(connection)
			return
		}
		connection.Release()
	}()
	return retryWikiTransaction(ctx, func() error {
		tx, err := connection.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if err := admit(tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	})
}
