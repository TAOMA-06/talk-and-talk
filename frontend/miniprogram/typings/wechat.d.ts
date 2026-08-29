declare const wx: any;
declare function App(options: any): any;
declare function Page(options: any): any;
declare function Component(options: {
  [key: string]: any;
  methods?: Record<string, (...args: any[]) => any> & ThisType<MiniProgramComponentInstance>;
  observers?: Record<string, (...args: any[]) => any> & ThisType<MiniProgramComponentInstance>;
} & ThisType<MiniProgramComponentInstance>): any;
declare function getApp(): any;

interface MiniProgramPageInstance {
  setData(data: Record<string, unknown>): void;
  data: Record<string, any>;
}

interface MiniProgramComponentInstance extends MiniProgramPageInstance {
  triggerEvent(name: string, detail?: Record<string, unknown>): void;
}
