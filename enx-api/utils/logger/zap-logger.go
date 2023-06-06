package logger

import (
	"fmt"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
	"log"
	"os"
	"strings"
	"time"
)

var sugaredLogger Logger
var dLogger Logger

func init() {
	dLogger = &defaultLogger{}
}
func Init(to, level, projectName string) {
	var cores []zapcore.Core

	var lvl zapcore.Level
	err := lvl.UnmarshalText([]byte(level))
	if err != nil {
		log.Println("invalid level:", level)
		return
	}

	logTo := strings.ToUpper(to)
	logFilePath := "N/A"
	if logTo == "" || strings.Contains(logTo, "CONSOLE") {
		cores = append(cores, zapcore.NewCore(getEncoder(), zapcore.Lock(os.Stdout), lvl))
	}
	if logTo != "" && strings.Contains(logTo, "FILE") {
		// file
		fileEncoder := getEncoder()
		logFilePath = fmt.Sprintf("/var/log/%s/%s.log", projectName, level)
		writer := zapcore.AddSync(&lumberjack.Logger{
			Filename:   logFilePath,
			MaxSize:    200, // megabytes
			MaxBackups: 3,
			MaxAge:     30, // days
		})
		cores = append(cores, zapcore.NewCore(fileEncoder, writer, lvl))
	}
	core := zapcore.NewTee(cores...)

	sugaredLogger = zap.New(core).Sugar()
	sugaredLogger.Infof("zap logger init, level: %s, to: %s, path: %s", level, to, logFilePath)
}

func GetLogger() Logger {
	if sugaredLogger != nil {
		return sugaredLogger
	} else {
		return dLogger
	}
}
func getEncoder() zapcore.Encoder {
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
		enc.AppendString(t.Format("2006-01-02 15:04:05.000"))
	}

	return zapcore.NewConsoleEncoder(encoderConfig)
}

func Debug(args ...interface{}) {
	GetLogger().Debug(args...)
}
func Debugf(msg string, args ...interface{}) {
	GetLogger().Debugf(msg, args...)
}
func Info(args ...interface{}) {
	GetLogger().Info(args...)
}
func Infof(msg string, args ...interface{}) {
	GetLogger().Infof(msg, args...)
}
func Error(args ...interface{}) {
	GetLogger().Error(args...)
}
func Errorf(msg string, args ...interface{}) {
	GetLogger().Errorf(msg, args...)
}
func Warn(args ...interface{}) {
	GetLogger().Warn(args...)
}
func Warnf(msg string, args ...interface{}) {
	GetLogger().Errorf(msg, args...)
}
func Sync() {
	GetLogger().Sync()
}

// Deprecated: Printf
func Println(args ...interface{}) {
	Info(args...)
}

// Deprecated: Printf
func Printf(msg string, args ...interface{}) {
	Infof(msg, args...)
}
