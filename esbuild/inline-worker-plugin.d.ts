declare module "worker-loader!*" {
  export default class InlineWorker extends Worker {
    constructor();
    static url: string;
  }
}

declare module "inline-worker!*" {
  export default class InlineWorker extends Worker {
    constructor();
    static url: string;
  }
}