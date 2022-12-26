export class DB {
  constructor(readonly path: string) {}
  get isOpen(): boolean {
    return true;
  }
}
