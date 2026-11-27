// Command wiktionary-build turns kaikki.org's Wiktextract data into the
// read-only SQLite file English-English lookups read (ADR-098, #1233). It is
// run by hand (`task wiktionary:build`), never in CI, and is not part of the
// server image.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	opts := options{Log: os.Stdout}
	flag.StringVar(&opts.Input, "input", "", "raw-wiktextract-data.jsonl.gz from kaikki.org (required)")
	flag.StringVar(&opts.ECDICT, "ecdict", "", "ECDICT stardict.db, read for POS ranking (required)")
	flag.StringVar(&opts.Out, "out", "", "SQLite file to create; must not exist (required)")
	flag.StringVar(&opts.SourceDate, "source-date", "", "kaikki extraction date, YYYY-MM-DD (required)")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, opts); err != nil {
		fmt.Fprintln(os.Stderr, "wiktionary-build:", err)
		stop()
		os.Exit(1)
	}
}
