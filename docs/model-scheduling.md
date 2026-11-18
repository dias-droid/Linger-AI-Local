# Model Scheduling

A model serves one more request only by slowing the others, and every agent,
approval and background job on a computer shares it. One queue per endpoint,
one runtime on one computer, decides what reaches the model: each unit of work
waits its turn by priority, and a unit that started is never interrupted.

| Endpoint                                           | Starts at | Grows to |
| -------------------------------------------------- | --------- | -------- |
| A runtime whose models go through a gateway or key | 1         | 8        |
| A runtime whose every model is on your account     | 10        | 10       |
| A computer that does not say how it reaches them   | 1         | 8        |

The number of units at once adapts to how the endpoint answers. While work
waits and requests come back about as fast as with one unit running, the
queue tries one more. When requests get clearly slower it gives one back, and
when the endpoint refuses work (rate limited, overloaded, or a call runs out
of time) it halves and holds off raising for a minute. Speed is compared per
thousand new prompt tokens, so a long prompt does not look like a busy
endpoint. A number it had to come down from is not tried again for five
minutes; if that retry is too slow as well, the wait doubles, up to half an
hour. What it learns lasts until the service restarts or the runtime's models
change.

The current adaptive limit is the hard limit. Ordinary work can start while
the total running count is below the soft limit, `max(1, hard - 1)`. Chat,
recording questions and standalone approvals can use the last place. At a
hard limit of one, the current unit finishes before the next starts. When
the limit drops, running units finish and new work respects the lower limit.
A Computer with an explicit Operation capacity also reserves its last place
for an interactive Run when that capacity exceeds one.

| Work in priority order       | Unit                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Tool approval                | The review borrows the reviewed Run's place on the same endpoint. A standalone review queues first. |
| Chat and recording questions | A chat Run or a question in a recording's Ask tab.                                                  |
| Tasks and documents          | Tasks, task callbacks, agent messages, document Runs and recording notes share one priority.        |
| Scheduled and proactive work | Routines, proactive Runs and automatic follow-ups share one priority.                               |
| Compaction                   | An idle conversation's session compaction. New work for that conversation cancels it.               |
| Background                   | Agent memory, user memory, profile, insights and wiki refresh, in descending priority.              |

Each Run holds one place across its tool calls. Inputs merged into a queued
Run take the highest priority among them. Eligible work at the same priority
starts in arrival order.

A wiki refresh is many units, not one: each routing pack, meeting, page batch
and correction queues on its own, so other work can run between them.

Every model call is retried and corrected in one place. A timeout, a reply past
its length cap or a runtime failure is tried again after a pause, and an answer
that does not fit its schema or its caller's checks is sent back with the
reason. How many tries a call gets depends on its kind.

<sub>The queue only admits work; it never reorders a conversation. Within one
chat, a new message joins the reply in progress or waits for the next one, so
turns stay in order.</sub>
