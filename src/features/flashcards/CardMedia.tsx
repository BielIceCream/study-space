import { useEffect, useRef, useState } from 'react';
import type { CardMetadata, StorageService } from '../../shared/types';

export function CardMedia({ metadata, side, storage }: { metadata?: CardMetadata; side: 'front' | 'back'; storage?: StorageService }) {
  const [images, setImages] = useState<{ url: string; alt: string }[]>([]);
  const marker=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  const hasImages=Boolean(metadata?.images.some(image=>image.side===side));
  useEffect(()=>{
    if(!hasImages||!marker.current)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'300px'});
    observer.observe(marker.current);return()=>observer.disconnect();
  },[hasImages]);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setImages([]);
    if (storage && visible) void Promise.all((metadata?.images ?? []).filter(image => image.side === side).map(async image => {
      try {
        const asset = await storage.getAsset(image.assetHash);
        if (!active || !/^image\/(png|jpeg|gif|webp|bmp)$/.test(asset.mimeType)) return null;
        const bytes = Uint8Array.from(atob(asset.dataBase64), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
        urls.push(url);
        return { url, alt: image.alt || 'Imagem do flashcard' };
      } catch { return null; }
    })).then(items => { if (active) setImages(items.filter((item): item is { url: string; alt: string } => Boolean(item))); });
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [metadata, side, storage,visible]);
  return hasImages ? <div ref={marker} className="card-media">{images.map(image => <img key={image.url} src={image.url} alt={image.alt} loading="lazy" style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain' }} />)}</div> : null;
}
