package youdao

import (
	"fmt"
	"github.com/PuerkitoBio/goquery"
	log "github.com/wiloon/pingd-log/logconfig/zaplog"
	"net/http"
	"net/url"
)

func Query(words string) string {
	baseUrl, _ := url.Parse("http://dict.youdao.com/")
	baseUrl.Path = fmt.Sprintf("w/eng/%s", words)
	params := url.Values{}
	params.Add("#keyfrom", "dict2.index")
	baseUrl.RawQuery = params.Encode()

	log.Infof("url: %v", baseUrl.String())
	resp, err := http.Get(baseUrl.String())
	if err != nil {
		fmt.Println(err)
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Fatalf("status code error: %d %s", resp.StatusCode, resp.Status)
	}
	// Load the HTML document
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	// Find the review items
	// .trans-container
	s := doc.Find("#phrsListTab .trans-container ul")
	log.Infof("chinese: %v", s.Text())
	return s.Text()
}
