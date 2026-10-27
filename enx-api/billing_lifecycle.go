package main

import "context"

type billingAssemblyLifecycle interface {
	Start(context.Context) error
	Done() <-chan struct{}
}

type billingLifecycle struct {
	cancel context.CancelFunc
	done   <-chan struct{}
}

func startBillingLifecycle(assembly billingAssemblyLifecycle) (*billingLifecycle, error) {
	ctx, cancel := context.WithCancel(context.Background())
	if err := assembly.Start(ctx); err != nil {
		cancel()
		return nil, err
	}
	return &billingLifecycle{cancel: cancel, done: assembly.Done()}, nil
}

func (l *billingLifecycle) stop(ctx context.Context) error {
	l.cancel()
	select {
	case <-l.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
