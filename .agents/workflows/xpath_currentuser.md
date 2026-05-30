---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any XPath constraint (entity access rule, microflow Retrieve, datasource filter) that references `[%CurrentUser%]`"
status: hard-enforced
enforcer: src/xpathValidator.ts
---

# `[%CurrentUser%]` in XPath Constraints — Planning Guidance

When an entity access rule, a microflow `Retrieve` XPath, or any other XPath
constraint needs to scope a query to "the current signed-in user", **only one
form is accepted**:

```
[id = '[%CurrentUser%]']
```

The form `…Account = '[%CurrentUser%]'` (comparing an association to
`'[%CurrentUser%]'`) is **hard-blocked** by `xpathValidator.ts`. Same goes for
any custom-named association used in place of the built-in `id`.

---

## Why the rule exists

`[%CurrentUser%]` resolves at runtime to the `id` of the signed-in
`System.User`. Comparing it to an _association_ token (`Account`, `Owner`,
etc.) leaks across the join boundary: the platform interprets the comparison
inconsistently between persistent retrievals, change-tracking rules, and
security XPaths, producing the classic "I can see other people's rows" bug.

Comparing it to the entity's own `id` works correctly **only when the entity
that owns the constraint is itself a `System.User` specialization** (directly
or transitively via `Administration.Account`). On any other entity, the
constraint must traverse an association to a user-specialization entity, e.g.
`Account_Order[id = '[%CurrentUser%]']`.

---

## Decision rule (apply this before authoring an XPath)

Before adding `[%CurrentUser%]` to any XPath, answer:

1. **Is the entity carrying the constraint a `System.User` specialization?**
   - Yes → use `[id = '[%CurrentUser%]']` on that entity directly.
   - No → traverse the association to the user-specialization entity first:
     `[ParentAssoc/Module.UserEntity[id = '[%CurrentUser%]']]`.

2. **If the source spec writes `Account = '[%CurrentUser%]'`**, the spec is
   wrong. Translate it to one of the two forms above. Never copy the literal
   form into the tool call — the validator will reject it.

3. **If the parent entity has no association to a user-specialization at all**,
   the planning artefact is incomplete. Flag the gap to the user before
   calling any tool: either add the association, generalize the entity (see
   `user_entity_generalization.md`), or revisit whether `[%CurrentUser%]`
   scoping is the right requirement.

---

## What this looks like at runtime

If a tool call (e.g. inside an entity access rule definition) carries an
XPath with the rejected form, `xpathValidator.ts` returns an error message
like:

```
XPath constraint uses 'Account = '[%CurrentUser%]'' which is not supported.
Use '[id = '[%CurrentUser%]']' on a System.User specialization, or traverse
the association: '[Account_Entity/System.User[id = '[%CurrentUser%]']]'.
See specs/rules/xpath_currentuser.md.
```

The tool call fails — no partial state is written.

---

## See also

- `user_entity_generalization.md` — the generalization choice that makes
  `[id = '[%CurrentUser%]']` work directly on a business entity.
- `system_members.md` — `hasOwner` / `hasChangedBy` for ownership tracking
  on non-user entities (alternative to a `[%CurrentUser%]` constraint).
- `expression_attribute_paths.md` — the broader rule that XPath bracket
  contents follow Mendix expression syntax (`$Var/AttrName`,
  `$Var/Module.Assoc/Module.Target/AttrName`), not the SDK
  `Module.Entity.AttrName` FQN.
- `mx-connect/src/xpathValidator.ts` — the canonical enforcement code.
