# Group Membership Lifecycle

## Verified from source contracts

- The creator is added as an active `group_admin` membership when a group is created, including creator-only creation with `members: []`.
- Invitees are accepted only when they are active users in the same tenant; they are stored as pending invited memberships.
- A user may request membership in an active group; repeated pending requests and already-active membership are rejected with controlled conflicts.
- A rejected membership must be explicitly reinstated; a suspended membership cannot silently rejoin.
- Group membership limits and optimistic concurrency are checked; `VersionError` maps to HTTP 409.
- Membership decisions use the canonical `transitionMembership` service and action-specific permission map.
- Membership request listing requires both permission and group-administrator authorization, and filters user records by tenant.

## Remaining evidence

Live MongoDB persistence, concurrency under multiple processes, end-to-end browser approval, every role combination, and cross-tenant HTTP negative cases were not run in this workspace. Member profile CRUD, transfer and complete group lifecycle management are not established by the active Groups route set.
