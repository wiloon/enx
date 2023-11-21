package youdao

import (
	"crypto/sha256"
	"enx-server/repo"
	"enx-server/utils/logger"
	"fmt"
	"github.com/google/uuid"
	"github.com/spf13/viper"
	"github.com/tidwall/gjson"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type Response struct {
	ReturnPhrase  string
	Query         string
	BasicExplains string
	Phonetic      string
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
