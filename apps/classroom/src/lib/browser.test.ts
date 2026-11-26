import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from './browser';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('browser.saveFile', () => {
  it('entrega o arquivo por um link de download temporário e libera o endereço depois', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:http://classroom.test/1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });

    const file = new Blob(['%PDF'], { type: 'application/pdf' });
    browser.saveFile(file, 'certificado-ABCD-EFGH-JKMN.pdf');

    expect(create).toHaveBeenCalledWith(file);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('certificado-ABCD-EFGH-JKMN.pdf');
    expect(clicks[0]?.href).toBe('blob:http://classroom.test/1');
    expect(clicks[0]?.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:http://classroom.test/1');
  });
});
