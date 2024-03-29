package redisx

import (
	"enx-server/utils/logger"
	"github.com/gomodule/redigo/redis"
	"github.com/spf13/viper"
	"strconv"
	"time"
)

var pool *redis.Pool

func init() {
	// connect()
}

func ZADD(key string, score int64, member string) {
	_, _ = Exec("ZADD", key, score, member)

}
func GetConn() redis.Conn {
	if pool == nil {
		pool = &redis.Pool{MaxIdle: 4, IdleTimeout: 60 * time.Second, Dial: func() (redis.Conn, error) {
			var err error
			address := viper.GetString("redis.address")
			conn, err := redis.Dial("tcp", address)
			if err != nil {
				logger.Errorf("failed to connect to redis:" + err.Error())
			}
			logger.Debugf("connected to redis, address: %v", address)
			return conn, err
		}}
	}
	return pool.Get()
}

func Exec(commandName string, args ...interface{}) (reply interface{}, err error) {
	conn := GetConn()
	defer func(conn redis.Conn) {
		err := conn.Close()
		if err != nil {
			logger.Errorf("failed to close conn")
		}
	}(conn)
	return conn.Do(commandName, args...)
}
func GetRankByScore(key string, score int64) int64 {
	var rank int64
	if score == 0 {
		rank = 0
	} else {
		logger.Debugf("get rank by score, key: %v, score: %v", key, score)

		r, err := Exec("ZRANGEBYSCORE", key, score, score)
		if err != nil {
			logger.Error(err)
		}
		foo := r.([]interface{})
		if len(foo) == 0 {
			return 0
		}
		member := string(foo[0].([]byte))

		t, _ := Exec("ZRANK", key, member)
		rank = t.(int64)
	}
	logger.Infof("got rank by score, score: %v, rank: %v", score, rank)
	return rank
}

func GetNewsIdListByScore(key string, scoreStart, scoreEnd int64) []string {
	var out []string
	r, err := Exec("ZRANGEBYSCORE", key, scoreStart, scoreEnd)
	if err != nil {
		logger.Error(err)
	}

	if r != nil {
		foo := r.([]interface{})
		for _, v := range foo {
			member := string(v.([]byte))
			out = append(out, member)
		}
	}

	return out
}
func GetScoreByRank(key string, rank int64) int64 {
	logger.Debugf("get score by rank, rank: %v", rank)
	result, err := Exec("ZRANGE", key, rank, rank)
	if err != nil {
		logger.Info("failed to get news")
	}
	foo := result.([]interface{})
	var scoreInt int64
	if len(foo) > 0 {
		bar := foo[0].([]byte)
		member := string(bar)
		logger.Debugf("rank: %v, member: %v", rank, member)
		t, _ := Exec("ZSCORE", key, member)
		score := t.([]byte)
		scoreStr := string(score)
		scoreInt, _ = strconv.ParseInt(scoreStr, 10, 64)
		logger.Debugf("get score by rank, rank: %v, score: %v ", rank, scoreInt)
	}

	return scoreInt
}
