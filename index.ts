

console.debug("AwayFL - 0.2.15");

// export {AVMAwayStage} from "./lib/AVMAwayStage";
export {ASObject} from "./lib/nat/ASObject";
export {ASClass} from "./lib/nat/ASClass";
export { ASArray } from './lib/nat/ASArray';
export { ASError } from "./lib/nat/ASError";

export {registerNativeClass, registerNativeFunction} from "./lib/nat/initializeBuiltins";

export {XMLDocument, XMLNode} from "./lib/natives/xml-document";

export {ByteArray, ObjectEncoding} from "./lib/natives/byteArray";
export {Uint32Vector} from "./lib/natives/uint32Vector";
export {Float64Vector} from "./lib/natives/float64Vector";
export {GenericVector} from "./lib/natives/GenericVector";
export { ASXML } from "./lib/natives/xml";

export { getCurrentABC } from "./lib/run/getCurrentABC";
export { axCoerceString } from "./lib/run/axCoerceString";
export { axIsCallable } from "./lib/run/axIsCallable";
export { axIsTypeString } from "./lib/run/axIsTypeString";
export {AXClass} from "./lib/run/AXClass";
export { AXFunction } from "./lib/run/AXFunction";
export { AXXMLClass } from "./lib/run/AXXMLClass";
export { AXObject } from "./lib/run/AXObject";
export { NamespaceType} from "./lib/abc/lazy/NamespaceType";
export { Multiname } from "./lib/abc/lazy/Multiname";

export { Errors } from "./lib/errors";
export { AMF3 } from './lib/amf';
export { constructClassFromSymbol } from './lib/constructClassFromSymbol';

export { AXApplicationDomain } from './lib/run/AXApplicationDomain';
export { AXSecurityDomain } from './lib/run/AXSecurityDomain';

export { checkNullParameter } from "./lib/run/checkNullParameter";

export { ABCFile } from './lib/abc/lazy/ABCFile';
export { initlazy } from './lib/abc/lazy';
export { initSystem } from "./lib/natives/system";

export { initializeAXBasePrototype } from './lib/run/initializeAXBasePrototype';

export { ActiveLoaderContext, OrphanManager } from './lib/run/axConstruct';
export { ABCCatalog } from "./lib/abc/lazy/ABCCatalog";

export {IPlayerGlobal} from "./lib/IPlayerGlobal";
export {AVM2Handler} from "./lib/AVM2Handler";
export {AVM2LoadLibrariesFlags} from "./lib/AVM2LoadLibrariesFlags";