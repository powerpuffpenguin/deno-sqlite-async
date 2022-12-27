import {
  Chan,
  ReadChannel,
  selectChan,
  WriteChannel,
} from "../deps/easyts/mod.ts";
import { background, Context } from "../deps/easyts/context/mod.ts";
export const errClosed = new Error("RW already closed");
export class RW {
  private wl_ = new Chan<number>();
  private wu_ = new Chan<number>();
  private rl_ = new Chan<number>();
  private ru_ = new Chan<number>();
  private w_ = false;
  private r_ = 0;
  constructor(readonly done: ReadChannel<void>) {
    this.serve();
  }
  async serve() {
    const done = this.done;
    const wl = this.wl_;
    const wu = this.wu_;
    const rl = this.rl_;
    const ru = this.ru_;

    const cdone = done.readCase();
    const cwl = wl.readCase();
    const cwu = wu.readCase();
    const crl = rl.readCase();
    const cru = ru.readCase();

    while (true) {
      if (this.w_) { // write lock wait unlock
        switch (await selectChan(cdone, cwu)) {
          case cwu:
            if (!this.w_) {
              throw new Error(`RW.unlock on w=${this.w_}`);
            } else if (this.r_ != 0) {
              throw new Error(`RW.unlock on r=${this.r_}`);
            }
            this.w_ = false;
            break;
          default:
            return;
        }
      } else if (this.r_ > 0) { // read lock wait unlock or mor read lock
        switch (await selectChan(cdone, crl, cru)) {
          case crl:
            if (this.w_) {
              throw new Error(`RW.readLock on w=${this.w_}`);
            }
            this.r_++;
            break;
          case cru:
            if (this.w_) {
              throw new Error(`RW.readUnlock on w=${this.w_}`);
            } else if (this.r_ < 1) {
              throw new Error(`RW.readUnlock on r=${this.r_}`);
            }
            this.r_--;
            break;
          default:
            return;
        }
      } else { // no lock wait write/read lock
        switch (await selectChan(cdone, cwl, crl)) {
          case cwl:
            if (this.w_) {
              throw new Error(`RW.lock on w=${this.w_}`);
            } else if (this.r_ > 0) {
              throw new Error(`RW.lock on r=${this.r_}`);
            }
            this.w_ = true;
            break;
          case crl:
            if (this.w_) {
              throw new Error(`RW.lock on w=${this.w_}`);
            }
            this.r_++;
            break;
          default:
            return;
        }
      }
    }
  }
  async _send(ctx: Context, ch: WriteChannel<number>): Promise<boolean> {
    if (ctx.isClosed) {
      return false;
    }
    const done = this.done;
    if (done.isClosed) {
      throw errClosed;
    }
    const cdone = done.readCase();
    const cd = ctx.done.readCase();
    const cw = ch.writeCase(0);
    switch (await selectChan(cdone, cd, cw)) {
      case cdone:
        throw errClosed;
      case cd:
        return false;
      case cw:
        break;
    }
    return true;
  }
  async lock(ctx: Context): Promise<Locked | undefined> {
    const ok = await this._send(ctx, this.wl_);
    if (ok) {
      return new _Locked(this);
    }
  }
  unlock(ctx: Context): Promise<boolean> {
    return this._send(ctx, this.wu_);
  }
  async readLock(ctx: Context): Promise<Locked | undefined> {
    const ok = await this._send(ctx, this.rl_);
    if (ok) {
      return new _Locked(this, true);
    }
  }
  readUnlock(ctx: Context): Promise<boolean> {
    return this._send(ctx, this.ru_);
  }
}
export interface Locked {
  unlock(): void;
}
class _Locked {
  constructor(readonly rw: RW, readonly read?: boolean) {}
  private ok = true;
  unlock() {
    if (this.ok) {
      this.ok = false;
      this._unlock();
    } else {
      throw new Error(`RW already unlocked`);
    }
  }
  async _unlock() {
    try {
      if (this.read) {
        await this.rw.readUnlock(background());
      } else {
        await this.rw.unlock(background());
      }
    } catch (_) { //
    }
  }
}
