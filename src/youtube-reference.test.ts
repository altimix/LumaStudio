import { describe, expect, it } from 'vitest';
import { emptyProject } from './model';
import { emptyYoutube } from './youtube';
import { resolveThumbnailReference } from '../shared/youtube-thumbnail.mjs';
import type { Asset } from './types';

const photo: Asset = { id: 'current-file', name: 'photo.jpg', path: '/moved/photo.jpg', url: 'media://photo', thumbnail: 'media://thumbnail', kind: 'image', duration: 0, width: 120, height: 160, fps: 0, hasAudio: false, waveform: [], size: 1024, codec: 'mjpeg' };
describe('thumbnail reference identity', () => {
  it('restores a portable reference without changing its edit ID or custom name', () => {
    const p = emptyProject(), saved = { ...photo, id: 'stable-edit-id', name: '主役の写真', revision: photo.id, offline: true, url: '', thumbnail: '' };
    p.assets = [saved]; p.youtube = { ...emptyYoutube(p), thumbnailReferenceAssetId: saved.id };
    expect(resolveThumbnailReference(p, photo)).toEqual({ ...photo, id: saved.id, name: saved.name, revision: photo.id });
    expect(p.assets[0]).toBe(saved); expect(saved.offline).toBe(true);
  });
  it('reuses an already online collected reference as well as an offline one', () => {
    const p = emptyProject(); p.assets = [{ ...photo, id: 'portable', revision: photo.id }];
    expect(resolveThumbnailReference(p, photo).id).toBe('portable');
  });
  it('keeps the selected reference when multiple stable IDs point to the same file', () => {
    const p = emptyProject(); p.assets = ['first', 'selected'].map(id => ({ ...photo, id, revision: photo.id, offline: true }));
    p.youtube = { ...emptyYoutube(p), thumbnailReferenceAssetId: 'selected' };
    expect(resolveThumbnailReference(p, photo).id).toBe('selected');
  });
  it('resolves an existing reference at the 2000-asset limit', () => {
    const p = emptyProject(); p.assets = Array.from({ length: 2000 }, (_, i) => ({ ...photo, id: `asset-${i}`, revision: `file-${i}`, offline: true }));
    p.assets[1999].revision = photo.id; p.youtube = { ...emptyYoutube(p), thumbnailReferenceAssetId: p.assets[1999].id };
    expect(resolveThumbnailReference(p, photo).id).toBe('asset-1999'); expect(p.assets).toHaveLength(2000);
  });
  it('preserves a new file identity when there is no matching image', () => {
    const p = emptyProject(); p.assets = [{ ...photo, id: 'different-photo', revision: 'different-file' }];
    expect(resolveThumbnailReference(p, photo)).toBe(photo);
  });
});
