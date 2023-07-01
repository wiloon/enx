package main

import (
	"bytes"
	"encoding/json"
	"enx-server/utils/logger"
	"fmt"
	"github.com/go-resty/resty/v2"
	"testing"
)

var client *resty.Client

func init() {
	client = resty.New()
}
func Test0(t *testing.T) {
	LoadCount()
}

func LoadCount() {
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
