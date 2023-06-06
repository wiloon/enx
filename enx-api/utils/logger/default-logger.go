package logger

import sdkLog "log"

type defaultLogger struct {
}

func (dl *defaultLogger) Debug(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Debugf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Info(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Infof(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Warn(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Warnf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Error(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Fatal(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Fatalf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Panic(args ...interface{}) {
	sdkLog.Println(args...)
}

func (dl *defaultLogger) Panicf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Sync() error {
	//TODO implement me
	panic("implement me")
}

func (dl *defaultLogger) Printf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}

func (dl *defaultLogger) Errorf(format string, args ...interface{}) {
	sdkLog.Printf(format, args...)
}
