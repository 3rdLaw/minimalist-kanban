e2e host leaf — committed fixture, do not delete.

The suite parks its shared leaf on this note between tests, so deleting a
test's own file can never tear the leaf down and force a window-raising
reopen.

It is committed rather than created per run because the `obsidian` CLI's
`create` does not fail on a name that is already taken: it succeeds having
made `_e2e_host 1.md` instead. Any run that ended without reaching its
cleanup therefore left this note behind and made the next run orphan a
numbered copy into this git-tracked vault.

Deliberately plain prose: no headings, no list items, no code fences and no
frontmatter, so nothing here can render as a kanban lane or card and poison
the document-wide selectors the tests rely on.
