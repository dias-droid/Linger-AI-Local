# Document source normalization

`normalizeDocumentContent` converts supported local source bytes to canonical
Markdown. Source selection uses a recognized MIME essence first, then the
filename and representation format. Generic or unspecified media types retain
those fallbacks.

Text sources accept MIME metadata such as CSV's `header=present` independently
of the character encoding. Parameters use MIME quoted-string parsing, so
`charset="UTF-8"` and semicolons inside quoted values are supported. An explicit
charset must be `utf-8` or `utf8`, case-insensitively; other declared encodings
are unsupported. Regardless of metadata, text bytes must pass strict UTF-8
decoding before format-specific conversion.
