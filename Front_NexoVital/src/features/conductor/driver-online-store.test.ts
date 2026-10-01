import { beforeEach, describe, expect, it } from 'vitest';
import { useDriverOnlineStore } from './driver-online-store';

function reset() {
  useDriverOnlineStore.setState({ online: false });
}

describe('driver-online-store', () => {
  beforeEach(reset);

  it('starts disconnected so a reload never surfaces offers', () => {
    expect(useDriverOnlineStore.getState().online).toBe(false);
  });

  it('goOnline flips the connection on', () => {
    useDriverOnlineStore.getState().goOnline();

    expect(useDriverOnlineStore.getState().online).toBe(true);
  });

  it('goOffline flips the connection off', () => {
    useDriverOnlineStore.getState().goOnline();
    useDriverOnlineStore.getState().goOffline();

    expect(useDriverOnlineStore.getState().online).toBe(false);
  });
});
