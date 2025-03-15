package main

import (
	"bytes"
	"encoding/json"
	"enx-server/enx"
	"enx-server/utils/logger"
	"fmt"
	"github.com/go-resty/resty/v2"
	"regexp"
	"testing"
		"enx-server/utils/sqlitex"
)

var client *resty.Client

func init() {
	client = resty.New()
	sqlitex.Init()
}

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z ]+`)

func TestWordsCount(t *testing.T) {
	words := "Watches from Switzerland are popular. Now, many people also buy secondhand Swiss watches. According to a study, the secondhand watch business is now worth almost 20 billion Swiss francs. It could reach 35 billion francs by 2030."
	enx.QueryCountInText(words)
}

func Test0(t *testing.T) {
	LoadCount0()
}

func LoadCount0() {
	url := fmt.Sprintf("http://%s/load-count?words=%s", "127.0.0.1:8080", "foo_bar")
	logger.Infof("request list, url: %s", url)

	resp, err := client.R().
		SetQueryParams(map[string]string{}).
		SetHeaders(map[string]string{
			"Content-Type": "application/json",
		}).
		Get(url)

	if err != nil {
		logger.Infof("request failed, err: %v", err)
	}

	body := string(resp.Body())
	println(body)

	var str bytes.Buffer
	_ = json.Indent(&str, resp.Body(), "", " ")
	println(str.String())

	return
}

func Test01(*testing.T) {
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("abc'def", ""))
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("'abcdef", ""))
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("abcdef'", ""))
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("'abc'def", ""))
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("abc'def'", ""))
	fmt.Println(nonAlphanumericRegex.ReplaceAllString("'abc'def'", ""))
}
