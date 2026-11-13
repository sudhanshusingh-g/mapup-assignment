package migrations

import "embed"

// FS embeds SQL migration files into the compiled binary so deployments remain self-contained.
//
//go:embed *.sql
var FS embed.FS
