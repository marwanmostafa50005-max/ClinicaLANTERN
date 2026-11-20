// The choices in tools/dev.mjs that do not start a process. Importing the script starts nothing:
// the server and the page start only when the file is run on its own. No model is called.
import { describe, expect, it } from 'vitest';

interface DevModule {
  serverPort: (envPort: string | undefined) => string;
  childAlive: (child: { exitCode: number | null; signalCode: string | null }) => boolean;
  stopAfterSeconds: (argv: string[]) => number;
  completeLines: (rest: string, chunk: string) => { lines: string[]; rest: string };
}

const dev = await import(new URL('./dev.mjs', import.meta.url).href) as DevModule;

describe('the working-mode script', () => {
  it('uses 8787 unless PORT is a whole number', () => {
    expect(dev.serverPort(undefined)).toBe('8787');
    expect(dev.serverPort('')).toBe('8787');
    expect(dev.serverPort('8788')).toBe('8788');
    expect(dev.serverPort('0')).toBe('0');
    expect(dev.serverPort('abc')).toBe('8787');
    expect(dev.serverPort('8788 ')).toBe('8787');
    expect(dev.serverPort('87.88')).toBe('8787');
  });

  it('reads --stop-after as a number of seconds, and treats a bad value as no timer', () => {
    expect(dev.stopAfterSeconds([])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '10'])).toBe(10);
    expect(dev.stopAfterSeconds(['--stop-after', '1.5'])).toBe(1.5);
    expect(dev.stopAfterSeconds(['--stop-after'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '0'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '-3'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', 'soon'])).toBe(0);
    expect(dev.stopAfterSeconds(['--other', '10'])).toBe(0);
  });

  it('counts a child as alive only while it has not exited and has not been signalled', () => {
    expect(dev.childAlive({ exitCode: null, signalCode: null })).toBe(true);
    expect(dev.childAlive({ exitCode: 0, signalCode: null })).toBe(false);
    expect(dev.childAlive({ exitCode: null, signalCode: 'SIGTERM' })).toBe(false);
  });

  it('keeps an unfinished line until the next chunk, and keeps a line that ends the chunk', () => {
    const first = dev.completeLines('', 'one\r\ntwo');
    expect(first.lines).toEqual(['one']);
    expect(first.rest).toBe('two');
    const second = dev.completeLines(first.rest, ' more\nthree\n');
    expect(second.lines).toEqual(['two more', 'three']);
    expect(second.rest).toBe('');
  });

  it('keeps a port of digits, drops a line that is only a break, and counts a signalled child as gone', () => {
    expect(dev.serverPort('00')).toBe('00');
    expect(dev.serverPort('8788\n')).toBe('8787');
    expect(dev.completeLines('', '')).toEqual({ lines: [], rest: '' });
    expect(dev.completeLines('a\n', '')).toEqual({ lines: ['a'], rest: '' });
    expect(dev.completeLines('', '\n')).toEqual({ lines: [''], rest: '' });
    expect(dev.childAlive({ exitCode: null, signalCode: '' })).toBe(false);
    expect(dev.childAlive({ exitCode: 1, signalCode: null })).toBe(false);
    expect(dev.stopAfterSeconds(['--stop-after', '0.0'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '0.1'])).toBe(0.1);
  });

  it('reads only the first stop time, and keeps a blank line between two breaks', () => {
    expect(dev.stopAfterSeconds(['--stop-after', '4', '--stop-after', '9'])).toBe(4);
    expect(dev.stopAfterSeconds(['--stop-after', 'soon', '--stop-after', '9'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', 'Infinity'])).toBe(Number.POSITIVE_INFINITY);
    expect(dev.stopAfterSeconds(['--stop-after', 'NaN'])).toBe(0);
    expect(dev.completeLines('', '\n\n')).toEqual({ lines: ['', ''], rest: '' });
  });

  it('reads a spaced number of seconds, and does not break a line on a bare return', () => {
    expect(dev.stopAfterSeconds(['--stop-after', ' 10'])).toBe(10);
    expect(dev.stopAfterSeconds(['--stop-after', '+2'])).toBe(2);
    expect(dev.stopAfterSeconds(['--stop-after', '1e1'])).toBe(10);
    expect(dev.serverPort(' 8788')).toBe('8787');
    expect(dev.completeLines('', 'one\rtwo\nthree')).toEqual({ lines: ['one\rtwo'], rest: 'three' });
    expect(dev.completeLines('one\r', 'two')).toEqual({ lines: [], rest: 'one\rtwo' });
    expect(dev.childAlive({ exitCode: null, signalCode: undefined as unknown as null })).toBe(false);
  });

  it('finds the stop time after the program name, and a bare line ending finishes the tail', () => {
    expect(dev.stopAfterSeconds(['node', 'tools/dev.mjs', '--stop-after', '10'])).toBe(10);
    expect(dev.stopAfterSeconds(['node', 'tools/dev.mjs'])).toBe(0);
    expect(dev.completeLines('tail', '\n')).toEqual({ lines: ['tail'], rest: '' });
    expect(dev.childAlive({ exitCode: undefined as unknown as null, signalCode: null })).toBe(false);
  });

  it('finishes a line when the break arrives in the next chunk, and ignores a stop flag in the wrong case', () => {
    expect(dev.completeLines('one\r', '\ntwo')).toEqual({ lines: ['one'], rest: 'two' });
    expect(dev.completeLines('keep', '')).toEqual({ lines: [], rest: 'keep' });
    expect(dev.serverPort('+8788')).toBe('8787');
    expect(dev.serverPort('-1')).toBe('8787');
    expect(dev.stopAfterSeconds(['--Stop-after', '10'])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '10 '])).toBe(10);
    expect(dev.childAlive({ exitCode: 0, signalCode: 'SIGTERM' })).toBe(false);
  });

  it('refuses a port that holds a tab, and reads a hexadecimal stop time as a number', () => {
    expect(dev.serverPort('8788\t')).toBe('8787');
    expect(dev.serverPort('   ')).toBe('8787');
    expect(dev.serverPort(null as unknown as undefined)).toBe('8787');
    expect(dev.stopAfterSeconds(['--stop-after', ''])).toBe(0);
    expect(dev.stopAfterSeconds(['--stop-after', '0x10'])).toBe(16);
    expect(dev.stopAfterSeconds(['--stop-after', '-0'])).toBe(0);
    expect(dev.completeLines('', 'a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], rest: '' });
    expect(dev.childAlive({ exitCode: null, signalCode: '0' })).toBe(false);
  });
});
