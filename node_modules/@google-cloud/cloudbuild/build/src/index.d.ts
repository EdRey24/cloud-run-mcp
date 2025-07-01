import * as v1 from './v1';
import * as v2 from './v2';
declare const CloudBuildClient: typeof v1.CloudBuildClient;
type CloudBuildClient = v1.CloudBuildClient;
export { v1, v2, CloudBuildClient };
declare const _default: {
    v1: typeof v1;
    v2: typeof v2;
    CloudBuildClient: typeof v1.CloudBuildClient;
};
export default _default;
import * as protos from '../protos/protos';
export { protos };
