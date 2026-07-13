declare const wx: any;
declare function App(options: any): any;
declare function Page(options: any): any;

interface MiniProgramPageInstance {
  setData(data: Record<string, unknown>): void;
  data: Record<string, any>;
}
