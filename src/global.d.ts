declare const __DEV__: boolean;
declare const __COMMIT__: string;

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
