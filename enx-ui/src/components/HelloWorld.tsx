'use client';

import { useState } from 'react';
import { atom, useAtom } from 'jotai';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const countAtom = atom(0);

export default function HelloWorld() {
  const [count, setCount] = useAtom(countAtom);
  const [message, setMessage] = useState('Hello World!');

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-center">{message}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <p className="text-lg">Count: {count}</p>
        </div>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => setCount(count + 1)}>
            Increment
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setCount(count - 1)}
          >
            Decrement
          </Button>
        </div>
        <div className="text-center">
          <Button 
            variant="secondary" 
            onClick={() => setMessage(message === 'Hello World!' ? 'Hello React!' : 'Hello World!')}
          >
            Toggle Message
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}