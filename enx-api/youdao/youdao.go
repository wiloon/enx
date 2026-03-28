package youdao

import (
	"enx-api/enx"
	"enx-api/utils/logger"
	"fmt"
	"log"
	"net/http"
	"net/url"

	"github.com/PuerkitoBio/goquery"
)

// Query is DEPRECATED: This function scrapes the Youdao website HTML, which may violate ToS.
// Use QueryAPI() instead, which calls the official Youdao API.
// This function is kept for backward compatibility only and may be removed in future versions.
//
// Deprecated: Use QueryAPI instead.
func Query(words string) *enx.Dictionary {
	baseUrl, _ := url.Parse("https://dict.youdao.com/")
	baseUrl.Path = fmt.Sprintf("w/eng/%s", words)
	params := url.Values{}
	params.Add("#keyfrom", "dict2.index")
	baseUrl.RawQuery = params.Encode()

	logger.Infof("url: %v", baseUrl.String())
	resp, err := http.Get(baseUrl.String())
	if err != nil {
		fmt.Println(err)
		return nil
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

	p := doc.Find("#phrsListTab .phonetic")
	logger.Infof("pronounce: %v", p.Text())

	// Find the review items
	// .trans-container
	s := doc.Find("#phrsListTab .trans-container ul")
	logger.Infof("chinese: %v", s.Text())
	epc := &enx.Dictionary{}
	epc.English = words
	epc.Pronunciation = p.Text()
	epc.Chinese = s.Text()
	return epc
}
