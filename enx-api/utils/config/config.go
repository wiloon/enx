package config

import (
	"fmt"
	"github.com/pelletier/go-toml"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const sysEnvKeyAppConfig = "APP_CONFIG_PATH"

var defaultFileName = "config.toml"

var configFilePath string
var conf *toml.Tree

func init() {
	LoadLocalConfig(defaultFileName)
}
func LoadLocalConfig(configFileName string) {
	log.Println("loading config file")
	defaultFileName = configFileName

	configFilePath = configPath()
	LoadConfigByPath(configFilePath)
}

func LoadConfigByPath(fullPath string) {
	log.Printf("load config by path: %s\n", fullPath)
	if !isFileExist(fullPath) {
		log.Println("config file not found:", fullPath)
		return
	}

	b, err := ioutil.ReadFile(fullPath)
	if err != nil {
		fmt.Print(err)
	}
	str := string(b)
	log.Printf("config file content: \n%v", str)

	conf, _ = toml.Load(str)
}

func configPath() string {
	path := os.Getenv(sysEnvKeyAppConfig)
	if path != "" && isFileExist(getConfigFilePath(path)) {
		return configFileFullPath(path)
	}
	path = execPath()
	if path != "" && isFileExist(getConfigFilePath(path)) {
		return configFileFullPath(path)
	}

	path = currentPath()

	fullPath := filepath.Join(path, defaultFileName)
	log.Println("config file path:", fullPath)
	return fullPath
}
func configFileFullPath(path string) string {
	return filepath.Join(path, defaultFileName)
}

func getConfigFilePath(configPath string) string {
	return filepath.Join(configPath, defaultFileName)
}

func GetInt(key string) int64 {
	var foo int64
	foo = -1
	return GetIntWithDefaultValue(key, foo)
}

func GetBool(key string) bool {
	return GetBoolWithDefaultValue(key, false)
}

//func GetStringList(key string) []string {
//	return conf.Get(key).(string)
//}

func GetString(key string, def string) string {
	var value string
	if conf == nil {
		value = def
	} else {
		obj := conf.Get(key)
		if obj == nil {
			value = def
		} else {
			value = obj.(string)
		}
	}

	// log.Printf("key: %s, value: %s", key, value)

	return value
}

func GetIntWithDefaultValue(key string, def int64) int64 {
	var value int64
	if conf == nil {
		return def
	}

	k := conf.Get(key)
	if k == nil {
		value = def
	} else {
		value = k.(int64)
	}

	log.Printf("key: %s, value: %v", key, value)

	return value
}

func GetBoolWithDefaultValue(key string, def bool) bool {
	var result bool
	obj := conf.Get(key)
	if obj == nil {
		result = def
	} else {
		result = obj.(bool)
	}
	return result
}

func isFileExist(filePath string) bool {
	_, err := os.Stat(filePath)
	fileExist := err == nil || os.IsExist(err)

	log.Printf("file: %s, exist:%v", filePath, fileExist)
	return fileExist
}

func execPath() string {
	dir, err := filepath.Abs(filepath.Dir(os.Args[0]))
	if err != nil {
		log.Fatal(err)
	}
	return strings.Replace(dir, "\\", "/", -1)
}

func currentPath() string {
	currentPath, _ := os.Getwd()
	return currentPath
}
