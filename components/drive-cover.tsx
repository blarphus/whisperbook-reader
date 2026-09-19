'use client';
import {useEffect, useState} from 'react';

export function DriveCover({src, alt}: {src: string; alt: string}) {
  const relay = src.includes('&asset=cover');
  const [source, setSource] = useState(relay ? '' : src);
  useEffect(() => {
    if (!relay) {setSource(src); return;}
    const controller = new AbortController();
    setSource('');
    async function load() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(src, {signal: controller.signal, cache: 'no-store'});
          const value = await response.json() as {type?: string; data?: string};
          if (!response.ok || !value.type?.startsWith('image/') || !value.data) throw Error('Cover could not load.');
          if (!controller.signal.aborted) setSource(`data:${value.type};base64,${value.data}`);
          return;
        } catch {
          if (controller.signal.aborted) return;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [src, relay]);
  return <img src={source || '/covers/placeholder.svg'} alt={alt} loading="eager" decoding="async" fetchPriority="high"/>;
}
