package enx

import (
	"github.com/wiloon/pingd-config"
	"github.com/wiloon/pingd-data/mysql"
)

var enxDb *mysql.Database

func Search(key string) []string {
	var result []string
	tmp := instance().Find("select english from tbl_ecp where english like '" + key + "%' order by english limit 20")
	for _, v := range tmp {
		result = append(result, string(v["english"].([]uint8)))
	}
	return result
}

func instance() *mysql.Database {
	if enxDb == nil {
		address := config.GetString("mysql.address", "127.0.0.1:3306")
		user := config.GetString("mysql.user", "user0")
		password := config.GetString("mysql.password", "password0")
		mysqlConfig := mysql.Config{DatabaseName: "enx", Address: address, Username: user, Password: password}
		enxDb = mysql.NewDatabase(mysqlConfig)
	}
	return enxDb
}

type Dictionary struct {
	English       string
	Chinese       string
	Pronunciation string
	CreateTime    string
}

func FindOne(key string) *Dictionary {
	var dict Dictionary
	tmp := instance().Find("select * from tbl_ecp where english=? order by create_datetime asc  limit 1", key)
	if tmp != nil && len(tmp) > 0 {
		dict.English = string(tmp[0]["english"].([]uint8))
		dict.Chinese = string(tmp[0]["chinese"].([]uint8))
		if tmp[0]["pronunciation"] != nil {
			dict.Pronunciation = string(tmp[0]["pronunciation"].([]uint8))
		}
	}

	return &dict
}
