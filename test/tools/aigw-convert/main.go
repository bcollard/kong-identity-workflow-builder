// aigw-convert runs the converter behind `deck ai sync` (ai-deck-converter, pinned in go.mod to the version decK vendors).
//
//	go run . fields   > ../../fixtures/aigw-entity-model.fields.json   # YAML keys each entity accepts
//	go run . convert  < docs.json                                      # [yaml, ...] -> [{kong, warnings, error}, ...]
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"

	"github.com/Kong/ai-deck-converter/aigw"
	"github.com/Kong/ai-deck-converter/convert"
)

// fields describes a type as the YAML decoder sees it: "open" for maps and interfaces, a key map for structs.
func fields(t reflect.Type, seen map[reflect.Type]bool) any {
	for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice || t.Kind() == reflect.Array {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Struct:
		if seen[t] {
			return t.Name()
		}
		seen[t] = true
		defer delete(seen, t)
		out := map[string]any{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			tag := strings.Split(f.Tag.Get("yaml"), ",")
			if tag[0] == "-" || !f.IsExported() {
				continue
			}
			if len(tag) > 1 && tag[1] == "inline" {
				if m, ok := fields(f.Type, seen).(map[string]any); ok {
					for k, v := range m {
						out[k] = v
					}
				}
				continue
			}
			out[tag[0]] = fields(f.Type, seen)
		}
		return out
	case reflect.Map, reflect.Interface:
		return "open"
	default:
		return "scalar"
	}
}

type result struct {
	Kong     string   `json:"kong"`
	Warnings []string `json:"warnings"`
	Error    string   `json:"error,omitempty"`
}

func main() {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	switch arg := strings.Join(os.Args[1:], " "); arg {
	case "fields":
		m := fields(reflect.TypeOf(aigw.Document{}), map[reflect.Type]bool{}).(map[string]any)
		m["identity_providers"] = m["auth_strategies"] // deprecated alias still accepted on input
		must(enc.Encode(m))
	case "convert":
		var docs []string
		must(json.NewDecoder(os.Stdin).Decode(&docs))
		out := make([]result, len(docs))
		for i, d := range docs {
			kong, warnings, err := convert.Convert([]byte(d), convert.Options{}) // same options as `deck ai sync`
			out[i] = result{Kong: string(kong), Warnings: warnings}
			if err != nil {
				out[i].Error = err.Error()
			}
		}
		must(enc.Encode(out))
	default:
		fmt.Fprintln(os.Stderr, "usage: aigw-convert fields|convert")
		os.Exit(2)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
