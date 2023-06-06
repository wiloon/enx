package mysql

import (
	"fmt"
	"testing"
)

func Test0(t *testing.T) {
	db := NewDatabase(Config{
		Username:     "user0",
		Password:     "password0",
		DatabaseName: "nj4xx",
		Address:      "192.168.50.220",
	})
	result := db.Find("select * from test_data")
	for i, v := range result {
		fmt.Println(i, v)
	}
}
