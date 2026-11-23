package skill

import "strings"

// PolicyConflict identifies the failed Skill policy and the records involved, without configuration values.
type PolicyConflict struct {
	Code       string
	References []string
	Reason     string
}

func (e *PolicyConflict) Error() string {
	description := "Skill configuration requires repair: " + e.Reason
	if len(e.References) > 0 {
		description += " (" + strings.Join(e.References, ", ") + ")"
	}
	return description
}

func (e *PolicyConflict) Unwrap() error { return ErrConflict }

func newPolicyConflict(code, reason string, references ...string) error {
	if len(references) > 10 {
		references = references[:10]
	}
	return &PolicyConflict{Code: code, References: references, Reason: reason}
}

// ManagedDefaultConflict identifies the platform default that reserves a package name.
func ManagedDefaultConflict(name, skillID string) error {
	return newPolicyConflict("managed_default_name", "Package name "+name+" belongs to a managed default Skill", skillID)
}
