package youdao

import (
	"crypto/sha256"
	"enx-api/enx"
	"enx-api/repo"
	"enx-api/utils/logger"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/viper"
	"github.com/tidwall/gjson"
)

// maxWordsPerQuery is the maximum number of words allowed in a single Youdao API query.
// This prevents excessive API quota consumption from long sentences.
const maxWordsPerQuery = 4

type Response struct {
	ReturnPhrase  string
	Query         string
	BasicExplains string
	Phonetic      string
}

// QueryAPI calls the official Youdao API and returns the result in enx.Dictionary format.
// This is the recommended way to translate words, replacing the deprecated web scraping approach.
//
// The function uses the official Youdao OpenAPI (https://openapi.youdao.com/api) with proper
// authentication (appKey + appSecret + SHA256 signature) to avoid legal issues with web scraping.
//
// Results are cached in the database to avoid redundant API calls.
// Input is limited to maxWordsPerQuery words to prevent excessive API quota consumption.
func QueryAPI(words string) *enx.Dictionary {
	// Reject queries with too many words to avoid consuming API quota
	wordCount := len(strings.Fields(words))
	if wordCount > maxWordsPerQuery {
		logger.Infof("youdao query rejected: %d words exceeds limit of %d, input: %q", wordCount, maxWordsPerQuery, words)
		return nil
	}

	resp := Translate(words)
	if resp == nil {
		return nil
	}

	// Convert Response to Dictionary format
	dict := &enx.Dictionary{
		English:       resp.Query,
		Chinese:       resp.BasicExplains,
		Pronunciation: resp.Phonetic,
	}
	return dict
}

func Translate(words string) *Response {
	// check if words already exist
	cacheHit, youdaoCanHandleThisWorld, youdaoCache := repo.IsYouDaoRecordExist(words)
	if cacheHit && !youdaoCanHandleThisWorld {
		return nil
	} else if cacheHit && youdaoCanHandleThisWorld {
		result := youdaoCache.Result
		return parseResponse(result)
	}

	size := len(words)
	if size > 20 {
		words = words[0:10] + strconv.Itoa(size) + words[size-10:size]
	}

	appKey := viper.GetString("youdao.app-key")
	salt := uuid.New().String()
	currentSecond := time.Now().Unix()
	currentSecondStr := strconv.FormatInt(currentSecond, 10)
	appSecret := viper.GetString("youdao.app-secret")

	signStr := appKey + words + salt + currentSecondStr + appSecret
	sum := sha256.Sum256([]byte(signStr))
	sign := fmt.Sprintf("%x", sum)

	logger.Infof("call youdao api, words: %v", words)
	response, err := http.PostForm(viper.GetString("youdao.url"), url.Values{
		"from":     {"en"},
		"to":       {"zh-CHS"},
		"signType": {"v3"},
		"curtime":  {currentSecondStr},
		"appKey":   {appKey},
		"q":        {words},
		"salt":     {salt},
		"sign":     {sign},
	})

	if err != nil {
		//handle postform error
	}

	defer response.Body.Close()
	logger.Infof("you dao api response status code: %v", response.StatusCode)
	if response.StatusCode != 200 {
		logger.Infof("status code error: %d %s", response.StatusCode, response.Status)
		repo.SaveYouDaoDictResponse(words, "", 0)
		return nil
	}

	body, err := io.ReadAll(response.Body)
	logger.Infof("read response body: %v, err: %v", body, err)
	if err != nil {
		//handle read response error
	}
	jsonStringBody := string(body)
	logger.Infof("read response body: %v", jsonStringBody)

	errorCode := gjson.Get(jsonStringBody, "errorCode").String()
	logger.Infof("error code: %v", errorCode)
	if errorCode != "0" {
		repo.SaveYouDaoDictResponse(words, "", 0)
		return nil
	}
	repo.SaveYouDaoDictResponse(words, jsonStringBody, 1)
	return parseResponse(jsonStringBody)
}

func parseResponse(jsonBody string) *Response {
	youdaoResponse := Response{}
	youdaoResponse.ReturnPhrase = gjson.Get(jsonBody, "returnPhrase").String()
	youdaoResponse.Query = gjson.Get(jsonBody, "query").String()
	youdaoResponse.BasicExplains = gjson.Get(jsonBody, "basic.explains").String()
	youdaoResponse.Phonetic = gjson.Get(jsonBody, "basic.us-phonetic").String()
	return &youdaoResponse
}
