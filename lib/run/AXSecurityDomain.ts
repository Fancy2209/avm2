import { AXApplicationDomain } from './AXApplicationDomain';
import { ClassAliases } from '../amf';
import { AXClass, IS_AX_CLASS } from './AXClass';
import { AXMethodClosureClass } from './AXMethodClosureClass';
import { AXXMLClass } from './AXXMLClass';
import { AXXMLListClass } from './AXXMLListClass';
import { AXQNameClass } from './AXQNameClass';
import { AXNamespaceClass } from './AXNamespaceClass';
import { GenericVector } from '../natives/GenericVector';
import { Int32Vector } from '../natives/int32Vector';
import { Uint32Vector } from '../natives/uint32Vector';
import { Float64Vector } from '../natives/float64Vector';
import { XMLParser } from '../natives/xml';
import { AXObject } from './AXObject';
import { ABCCatalog } from '../abc/lazy/ABCCatalog';
import { Multiname } from '../abc/lazy/Multiname';
import { ABCFile } from '../abc/lazy/ABCFile';
import { NamespaceType } from '../abc/lazy/NamespaceType';
import { ClassInfo } from '../abc/lazy/ClassInfo';
import { RuntimeTraits } from '../abc/lazy/RuntimeTraits';
import { MethodInfo } from '../abc/lazy/MethodInfo';
import { ExceptionInfo } from '../abc/lazy/ExceptionInfo';
import { ScriptInfo } from '../abc/lazy/ScriptInfo';
import { runtimeWriter } from './writers';
import { formatErrorMessage, Errors } from '../errors';
import { transformJSValueToAS } from '../nat/transformJSValueToAS';
import { tryLinkNativeClass } from '../nat/tryLinkNativeClass';
import { getNativeInitializer } from '../nat/getNativeInitializer';
import { installClassLoaders } from '../nat/installClassLoaders';
import { installNativeFunctions } from '../nat/installNativeFunctions';
import { release, isIndex, IndentingWriter, defineNonEnumerableProperty,
	defineReadOnlyProperty, flashlog, AVMStage } from '@awayfl/swf-loader';
import { assert } from '@awayjs/graphics';
import { checkValue } from './checkValue';
import { Scope } from './Scope';
import { axInterfaceInitializer } from './axInterfaceInitializer';
import { axIsInstanceOfInterface } from './axIsInstanceOfInterface';
import { axIsTypeInterface } from './axIsTypeInterface';
import { interpret } from '../int';
import { applyTraits } from './applyTraits';
import { AXFunction } from './AXFunction';
import { AXCallable } from './AXCallable';
import { AXActivation } from './AXActivation';
import { AXCatch } from './AXCatch';
import { AXGlobal } from './AXGlobal';
import { axCoerce } from './axCoerce';
import { axIsInstanceOfObject } from './axIsInstanceOfObject';
import { axConstruct, axConstructFast } from './axConstruct';
import { axDefaultApply } from './axDefaultApply';
import { axDefaultInitializer } from './axDefaultInitializer';
import { axGetArgumentsCallee } from './axGetArgumentsCallee';
import { axCoerceBoolean } from './axCoerceBoolean';
import { axIsTypeBoolean } from './axIsTypeBoolean';
import { axConvertString } from './axConvertString';
import { axIsTypeString } from './axIsTypeString';
import { axCoerceString } from './axCoerceString';
import { axCoerceNumber } from './axCoerceNumber';
import { axIsTypeNumber } from './axIsTypeNumber';
import { axCoerceInt } from './axCoerceInt';
import { axFalse } from './axFalse';
import { axIsTypeInt } from './axIsTypeInt';
import { axCoerceUint } from './axCoerceUint';
import { axIsTypeUint } from './axIsTypeUint';
import { isPrimitiveJSValue } from './isPrimitiveJSValue';
import { axBoxIdentity } from './axBoxIdentity';
import { axIsTypeObject } from './axIsTypeObject';
import { axAsType } from './axAsType';
import { axBoxPrimitive } from './axBoxPrimitive';
import { axApplyObject } from './axApplyObject';
import { axConstructObject } from './axConstructObject';
import { axCoerceObject } from './axCoerceObject';

import { initializeAXBasePrototype, AXBasePrototype } from './initializeAXBasePrototype';
import { ByteArrayDataProvider } from '../natives/byteArray';
import { IS_EXTERNAL_CLASS } from '../ext/external';
import { nativeClasses } from '../nat/builtinNativeClasses';
import { ASClass } from '../nat/ASClass';
import { IGlobalInfo } from '../abc/lazy/IGlobalInfo';

/**
 * Provides security isolation between application domains.
 */
export class AXSecurityDomain {
	public player: AVMStage;

	//   public static instance:any;
	public system: AXApplicationDomain;
	public application: AXApplicationDomain;
	public classAliases: ClassAliases;
	public AXObject: AXClass;
	public AXArray: AXClass;
	public AXClass: AXClass;
	public AXFunction: AXClass;
	public AXMethodClosure: AXMethodClosureClass;
	public AXError: AXClass;
	public AXNumber: AXClass;
	public AXInt: AXClass;
	public AXUint: AXClass;
	public AXString: AXClass;
	public AXBoolean: AXClass;
	public AXRegExp: AXClass;
	public AXMath: AXClass;
	public AXDate: AXClass;

	public AXXML: AXXMLClass;
	public AXXMLList: AXXMLListClass;
	public AXNamespace: AXNamespaceClass;
	public AXQName: AXQNameClass;

	public ObjectVector: typeof GenericVector;
	public Int32Vector: typeof Int32Vector;
	public Uint32Vector: typeof Uint32Vector;
	public Float64Vector: typeof Float64Vector;
	// static AXSecurityDomain: any;

	public get xmlParser(): XMLParser {
		return this._xmlParser || (this._xmlParser = new XMLParser(this));
	}

	private _xmlParser: XMLParser;

	private AXPrimitiveBox;
	private AXGlobalPrototype;
	private AXActivationPrototype;
	private AXCatchPrototype;
	private _AXFunctionUndefinedPrototype;

	public get AXFunctionUndefinedPrototype() {
		return this._AXFunctionUndefinedPrototype ||
              (this._AXFunctionUndefinedPrototype = this.createObject());
	}

	public objectPrototype: AXObject;
	public argumentsPrototype: AXObject;
	private rootClassPrototype: AXObject;

	private nativeClasses: any;
	private vectorClasses: Map<AXClass, AXClass>;

	private _catalogs: ABCCatalog [];

	//   public flash:any;
	//   public player:any;
	constructor() {
		initializeAXBasePrototype();
		this.system = new AXApplicationDomain(this, null);
		this.application = new AXApplicationDomain(this, this.system);
		this.classAliases = new ClassAliases();
		this.nativeClasses = Object.create(null);
		this.vectorClasses = new Map<AXClass, AXClass>();
		this._catalogs = [];
	}

	addCatalog(abcCatalog: ABCCatalog) {
		this._catalogs.push(abcCatalog);
	}

	findDefiningABC(mn: Multiname): ABCFile {
		runtimeWriter && runtimeWriter.writeLn('findDefiningABC: ' + mn);
		let abcFile = null;
		for (let i = 0; i < this._catalogs.length; i++) {
			const abcCatalog = this._catalogs[i];
			abcFile = abcCatalog.getABCByMultiname(mn);
			if (abcFile) {
				return abcFile;
			}
		}
		return null;
	}

	throwError(
		className: string,
		error: any,
		replacement1?: any,
		replacement2?: any,
		replacement3?: any,
		replacement4?: any
	) {
		throw this.createError(className, error, replacement1, replacement2, replacement3, replacement4);
	}

	createError(
		className: string,
		error: any,
		replacement1?: any,
		replacement2?: any,
		replacement3?: any,
		replacement4?: any
	) {
		const message = formatErrorMessage.call(null, error, replacement1, replacement2, replacement3, replacement4);
		const mn = Multiname.FromFQNString(className, NamespaceType.Public);
		const axClass: AXClass = <AXClass> this.system.getProperty(mn, true, true);

		return axConstructFast(axClass, [message, error.code]);
	}

	applyType(axClass: AXClass, types: AXClass []): AXClass {
		const vectorProto = (<AXClass><any> this.ObjectVector.axClass).superClass.dPrototype;
		if (!vectorProto.isPrototypeOf(axClass.dPrototype)) {
			this.throwError('TypeError', Errors.TypeAppOfNonParamType);
		}
		if (types.length !== 1) {
			this.throwError('TypeError', Errors.WrongTypeArgCountError, '__AS3__.vec::Vector', 1,
				types.length);
		}
		const type = types[0] || this.AXObject;
		return this.getVectorClass(type);
	}

	getVectorClass(type: AXClass): AXClass {
		let vectorClass = this.vectorClasses.get(type);
		if (vectorClass) {
			return vectorClass;
		}
		const typeClassName = type && type.classInfo ?
			type.classInfo.instanceInfo.multiname.getMangledName() :
			'$BgObject';
		switch (typeClassName) {
			case '$BgNumber':
			case '$Bgdouble':
				vectorClass = <any> this.Float64Vector.axClass;
				break;
			case '$Bgint':
				vectorClass = <any> this.Int32Vector.axClass;
				break;
			case '$Bguint':
				vectorClass = <any> this.Uint32Vector.axClass;
				break;
			default:
				vectorClass = this.createVectorClass(type);
		}
		this.vectorClasses.set(type, vectorClass);
		return vectorClass;
	}

	createVectorClass(type: AXClass): AXClass {
		const genericVectorClass = this.ObjectVector.axClass;
		const axClass: AXClass = Object.create(genericVectorClass);
		// Put the superClass tPrototype on the prototype chain so we have access
		// to all factory protocol handlers by default.
		axClass.tPrototype = Object.create(genericVectorClass.tPrototype);
		axClass.tPrototype.axClass = axClass;
		axClass.tPrototype.axClassName = axClass.classInfo.instanceInfo.getClassName();
		// We don't need a new dPrototype object.
		axClass.dPrototype = <any>genericVectorClass.dPrototype;
		axClass.superClass = <any>genericVectorClass;
		(<any>axClass).type = type;
		return axClass;
	}

	/**
     * Constructs a plain vanilla object in this security domain.
     */
	createObject() {
		return Object.create(this.AXObject.tPrototype);
	}

	/**
     * Takes a JS Object and transforms it into an AXObject.
     */
	createObjectFromJS(value: Object, deep: boolean = false) {
		const keys = Object.keys(value);
		const result = this.createObject();
		for (let i = 0; i < keys.length; i++) {
			let v = value[keys[i]];
			if (deep) {
				v = transformJSValueToAS(this, v, true);
			}
			result.axSetPublicProperty(keys[i], v);
		}
		return result;
	}

	/**
     * Constructs an AXArray in this security domain and sets its value to the given array.
     * Warning: This doesn't handle non-indexed keys.
     */
	createArrayUnsafe(value: any[]) {
		const array = Object.create(this.AXArray.tPrototype);
		array.value = value;
		if (!release) { // Array values must only hold index keys.
			for (const k in value) {
				assert(isIndex(k));
				checkValue(value[k]);
			}
		}
		return array;
	}

	/**
     * Constructs an AXArray in this security domain and copies all enumerable properties of
     * the given array, setting them as public properties on the AXArray.
     * Warning: this does not use the given Array as the `value`.
     */
	createArray(value: any[]) {
		const array = this.createArrayUnsafe([]);
		for (const k in value) {
			array.axSetPublicProperty(k, value[k]);
			release || checkValue(value[k]);
		}
		array.length = value.length;
		return array;
	}

	/**
     * Constructs an AXFunction in this security domain and sets its value to the given function.
     */
	boxFunction(value: Function) {
		const fn = Object.create(this.AXFunction.tPrototype);
		fn.value = value;
		return fn;
	}

	createClass(classInfo: ClassInfo, superClass: AXClass, scope: Scope): AXClass {
		const instanceInfo = classInfo.instanceInfo;
		const className = instanceInfo.multiname.toFQNString(false);
		const axClass: AXClass = this.nativeClasses[className] ||
									Object.create(this.AXClass.tPrototype);
		const classScope = new Scope(scope, axClass);
		if (!this.nativeClasses[className]) {
			if (instanceInfo.isInterface()) {
				axClass.dPrototype = Object.create(this.objectPrototype);
				axClass.tPrototype = Object.create(axClass.dPrototype);
				axClass.tPrototype.axInitializer = axInterfaceInitializer;
				axClass.axIsInstanceOf = axIsInstanceOfInterface;
				axClass.axIsType = axIsTypeInterface;
			} else {
				// For direct descendants of Object, we want the dynamic prototype to inherit from
				// Object's tPrototype because Foo.prototype is always a proper instance of Object.
				// For all other cases, the dynamic prototype should extend the parent class's
				// dynamic prototype not the tPrototype.
				if (superClass === this.AXObject) {
					axClass.dPrototype = Object.create(this.objectPrototype);
				} else if (superClass.dPrototype) {
					axClass.dPrototype = Object.create(superClass.dPrototype);
				} else {
					axClass.dPrototype = Object.create((<any>superClass).prototype);
					// mark that has external prototupe of chain
					Object.defineProperty(axClass.dPrototype, IS_EXTERNAL_CLASS, { value: true });
				}
				axClass.tPrototype = Object.create(axClass.dPrototype);
				axClass.tPrototype.axInitializer = this.createInitializerFunction(classInfo, classScope);
			}
		} else {
			axClass.tPrototype.axInitializer = this.createInitializerFunction(classInfo, classScope);
			// Native classes have their inheritance structure set up during initial SecurityDomain
			// creation.
			release || assert(axClass.dPrototype);
			release || assert(axClass.tPrototype);
		}

		axClass.classInfo = (<any>axClass.dPrototype).classInfo = classInfo;
		axClass.dPrototype.axClass = axClass;
		axClass.dPrototype.axClassName = classInfo.instanceInfo.getClassName();
		axClass.superClass = superClass;
		axClass.scope = scope;

		const forceNativeMethods = nativeClasses[className]
			? (<typeof ASClass>nativeClasses[className]).forceNativeMethods
			: false;

		// Object and Class have their traits initialized earlier to avoid circular dependencies.
		if (className !== 'Object' && className !== 'Class') {
			this.initializeRuntimeTraits(axClass, superClass, classScope, forceNativeMethods);
		}

		// Add the |constructor| property on the class dynamic prototype so that all instances can
		// get to their class constructor, and FooClass.prototype.constructor returns FooClass.
		defineNonEnumerableProperty(axClass.dPrototype, '$Bgconstructor', axClass);

		// Copy over all TS symbols.
		tryLinkNativeClass(axClass);

		// Create the global for for the class
		const global: AXGlobal = Object.create(this.AXGlobalPrototype);
		global.applicationDomain = classInfo.abc.applicationDomain;
		global.globalInfo = classInfo;
		classInfo.global = global;

		// Run the static initializer.
		const methodInfo = classInfo.methodInfo;
		const methodBodyCode = methodInfo.getBody().code;
		// ... except if it's the standard class initializer that doesn't really do anything.
		//208 = GETLOCAL0, 48 = PUSHSCOPE, 71 = RETURNVOID
		if (methodBodyCode[0] !== 208 || methodBodyCode[1] !== 48 || methodBodyCode[2] !== 71) {
			interpret(methodInfo, classScope, null).apply(axClass, [axClass]);
		}
		return axClass;
	}

	private initializeRuntimeTraits(
		axClass: AXClass, superClass: AXClass, scope: Scope, forceNativeMethods: boolean = false
	) {
		const classInfo = axClass.classInfo;
		const instanceInfo = classInfo.instanceInfo;

		// Prepare class traits.
		let classTraits: RuntimeTraits;
		if (axClass === this.AXClass) {
			classTraits = instanceInfo.traits.resolveRuntimeTraits(null, null, scope, forceNativeMethods);
		} else {
			const rootClassTraits = this.AXClass.classInfo.instanceInfo.runtimeTraits;
			release || assert(rootClassTraits);
			// Class traits don't capture the class' scope. This is relevant because it allows
			// referring to global names that would be shadowed if the class scope were active.
			// Haxe's stdlib uses just such constructs, e.g. Std.parseFloat calls the global
			// parseFloat.
			classTraits = classInfo.traits
				.resolveRuntimeTraits(rootClassTraits, null, scope.parent, forceNativeMethods);
		}
		classInfo.runtimeTraits = classTraits;
		applyTraits(axClass, classTraits);

		// Prepare instance traits.
		const superInstanceTraits = (superClass && superClass[IS_AX_CLASS])
			? superClass.classInfo.instanceInfo.runtimeTraits : null;

		const instanceTraits = instanceInfo.traits.resolveRuntimeTraits(superInstanceTraits,
			instanceInfo.protectedNs, scope, forceNativeMethods);
		instanceInfo.runtimeTraits = instanceTraits;
		applyTraits(axClass.tPrototype, instanceTraits);
	}

	createFunction(methodInfo: MethodInfo, scope: Scope, hasDynamicScope: boolean): AXFunction {
		//const traceMsg = !release && flashlog && methodInfo.trait ? methodInfo.toFlashlogString() : null;
		// eslint-disable-next-line no-var
		var fun = this.boxFunction(interpret(methodInfo, scope, fun));
		//fun.methodInfo = methodInfo;
		fun.receiver = { scope: scope };
		if (!release) {
			try {
				Object.defineProperty(fun.value, 'name', { value: methodInfo.name });
			} catch (e) {
				// Ignore errors in browsers that don't allow overriding Function#length;
			}
		}
		return fun;
	}

	createInitializerFunction(classInfo: ClassInfo, scope: Scope): AXCallable {
		const methodInfo = classInfo.instanceInfo.methodInfo;
		const traceMsg = !release && flashlog && methodInfo.trait ? methodInfo.toFlashlogString() : null;
		let fun: AXCallable = getNativeInitializer(classInfo);
		if (!fun) {
			release || assert(!methodInfo.isNative(), 'Must provide a native initializer for ' +
                                                  classInfo.instanceInfo.getClassName());

			const name = classInfo.instanceInfo.getClassName();
			const binarySymbol = classInfo.abc.applicationDomain.getBinarySymbol(name);

			if (binarySymbol)   {
				binarySymbol.buffer = binarySymbol.data;
				fun = <any> function () {
					release || console.log('create instance for binary data:', classInfo.instanceInfo.getClassName());
					ByteArrayDataProvider.symbolForConstructor = binarySymbol;
					release || (traceMsg && flashlog.writeAS3Trace(methodInfo.toFlashlogString()));
					return interpret(methodInfo, scope, null).apply(this, arguments);
				};
			} else {
				fun = <any> interpret(methodInfo, scope, null);
			}
			if (!release) {
				try {
					const className = classInfo.instanceInfo.multiname.toFQNString(false);
					Object.defineProperty(fun, 'name', { value: className });
				} catch (e) {
					// Ignore errors in browsers that don't allow overriding Function#length;
				}
			}
			// REDUX: enable arg count checking on native ctors. Currently impossible because natives
			// are frozen.
			fun.methodInfo = methodInfo;
		}
		return fun;
	}

	createActivation(methodInfo: MethodInfo, scope: Scope): AXActivation {
		const body = methodInfo.getBody();
		let aPrototype = body.activationPrototype;
		if (!aPrototype) {
			aPrototype = body.activationPrototype = Object.create(this.AXActivationPrototype);
			defineReadOnlyProperty(aPrototype, 'traits', body.traits.resolveRuntimeTraits(null, null, scope));
		}
		return Object.create(aPrototype);
	}

	createCatch(exceptionInfo: ExceptionInfo, scope: Scope): AXCatch {
		if (!exceptionInfo.catchPrototype) {
			const traits = exceptionInfo.getTraits();
			exceptionInfo.catchPrototype = Object.create(this.AXCatchPrototype);
			defineReadOnlyProperty(exceptionInfo.catchPrototype, 'traits',
				traits.resolveRuntimeTraits(null, null, scope));
		}
		return Object.create(exceptionInfo.catchPrototype);
	}

	box(v: any) {
		if (v == undefined)
			return v;

		if (v.constructor === Array)
			return this.AXArray.axBox(v);

		const t = typeof v;

		switch (t) {
			case 'number':
				return this.AXNumber.axBox(v);
			case 'boolean':
				return this.AXBoolean.axBox(v);
			case 'string':
				return this.AXString.axBox(v);
		}

		release || assert(AXBasePrototype.isPrototypeOf(v));

		return v;
	}

	isPrimitive(v: any) {
		return isPrimitiveJSValue(v) || this.AXPrimitiveBox.dPrototype.isPrototypeOf(v);
	}

	createAXGlobal(applicationDomain: AXApplicationDomain, globalInfo: IGlobalInfo) {
		const global: AXGlobal = Object.create(this.AXGlobalPrototype);
		global.applicationDomain = applicationDomain;
		global.globalInfo = globalInfo;

		const scope = global.scope = new Scope(null, global, false);
		const objectTraits = this.AXObject.classInfo.instanceInfo.runtimeTraits;
		const traits = globalInfo.traits.resolveRuntimeTraits(objectTraits, null, scope);

		applyTraits(global, traits);

		global[IS_AX_CLASS] = true;
		return global;
	}

	/**
     * Prepares the dynamic Class prototype that all Class instances (including Class) have in
     * their prototype chain.
     *
     * This prototype defines the default hooks for all classes. Classes can override some or
     * all of them.
     */
	prepareRootClassPrototype() {
		const dynamicClassPrototype: AXObject = Object.create(this.objectPrototype);
		const rootClassPrototype: AXObject = Object.create(dynamicClassPrototype);
		rootClassPrototype.$BgtoString = <any> function axClassToString() {
			return '[class ' + this.classInfo.instanceInfo.multiname.name + ']';
		};

		const D = defineNonEnumerableProperty;
		D(rootClassPrototype, 'axBox', axBoxIdentity);
		D(rootClassPrototype, 'axCoerce', axCoerce);
		D(rootClassPrototype, 'axIsType', axIsTypeObject);
		D(rootClassPrototype, 'axAsType', axAsType);
		D(rootClassPrototype, 'axIsInstanceOf', axIsInstanceOfObject);
		D(rootClassPrototype, 'axConstruct', axConstruct);
		D(rootClassPrototype, 'axApply', axDefaultApply);
		Object.defineProperty(rootClassPrototype, 'name', {
			get: function () {
				return this.classInfo.instanceInfo.multiname;
			}
		});

		rootClassPrototype[IS_AX_CLASS] = true;
		this.rootClassPrototype = rootClassPrototype;
	}

	private initializeCoreNatives() {
		// Some facts:
		// - The Class constructor is itself an instance of Class.
		// - The Class constructor is an instance of Object.
		// - The Object constructor is an instance of Class.
		// - The Object constructor is an instance of Object.

		this.prepareRootClassPrototype();
		const AXClass = this.prepareNativeClass('AXClass', 'Class', false);
		AXClass.classInfo = this.system.findClassInfo('Class');
		AXClass.defaultValue = null;

		let AXObject = this.prepareNativeClass('AXObject', 'Object', false);
		AXObject.classInfo = this.system.findClassInfo('Object');

		AXObject = this.AXObject;

		// AXFunction needs to exist for runtime trait resolution.
		const AXFunction = this.prepareNativeClass('AXFunction', 'Function', false);
		defineNonEnumerableProperty(AXFunction, 'axBox', axBoxPrimitive);

		// Initialization of the core classes' traits is a messy multi-step process:

		// First, create a scope for looking up all the things.
		const scope = new Scope(null, AXClass, false);

		// Then, create the runtime traits all Object instances share.
		const objectCI = this.AXObject.classInfo;
		const objectII = objectCI.instanceInfo;
		const objectRTT = objectII.runtimeTraits = objectII.traits.resolveRuntimeTraits(null, null,
			scope);
		applyTraits(this.AXObject.tPrototype, objectRTT);

		// Building on that, create the runtime traits all Class instances share.
		const classCI = this.AXClass.classInfo;
		const classII = classCI.instanceInfo;
		classII.runtimeTraits = classII.traits.resolveRuntimeTraits(objectRTT, null, scope);
		applyTraits(this.AXClass.tPrototype, classII.runtimeTraits);

		// As sort of a loose end, also create the one class trait Class itself has.
		classCI.runtimeTraits = classCI.traits.resolveRuntimeTraits(objectRTT, null, scope);
		applyTraits(this.AXClass, classCI.runtimeTraits);

		// Now we can create Object's runtime class traits.
		objectCI.runtimeTraits = objectCI.traits.resolveRuntimeTraits(classII.runtimeTraits, null,
			scope);
		applyTraits(this.AXObject, objectCI.runtimeTraits);

		AXObject[IS_AX_CLASS] = true;
		return AXObject;
	}

	prepareNativeClass(exportName: string, name: string, isPrimitiveClass: boolean) {
		const axClass: AXClass = Object.create(this.rootClassPrototype);

		// For Object and Class, we've already created the instance prototype to break
		// circular dependencies.
		if (name === 'Object') {
			axClass.dPrototype = <any>Object.getPrototypeOf(this.objectPrototype);
			axClass.tPrototype = this.objectPrototype;
		} else if (name === 'Class') {
			axClass.dPrototype = <any>Object.getPrototypeOf(this.rootClassPrototype);
			axClass.tPrototype = this.rootClassPrototype;
		} else {
			const instancePrototype = isPrimitiveClass ?
				this.AXPrimitiveBox.dPrototype :
				exportName === 'AXMethodClosure' ?
					this.AXFunction.dPrototype :
					this.objectPrototype;
			axClass.dPrototype = Object.create(instancePrototype);
			axClass.tPrototype = Object.create(axClass.dPrototype);
		}

		this[exportName] = this.nativeClasses[name] = axClass;
		axClass[IS_AX_CLASS] = true;
		return axClass;
	}

	preparePrimitiveClass(exportName: string, name: string, convert, defaultValue, coerce,
		isType, isInstanceOf) {
		const axClass = this.prepareNativeClass(exportName, name, true);
		const D = defineNonEnumerableProperty;
		D(axClass, 'axBox', axBoxPrimitive);
		D(axClass, 'axApply', function axApply(_ , args: any []) {
			return convert(args && args.length ? args[0] : defaultValue);
		});
		D(axClass, 'axConstruct', function axConstruct(args: any []) {
			return convert(args && args.length ? args[0] : defaultValue);
		});
		D(axClass, 'axCoerce', coerce);
		D(axClass, 'axIsType', isType);
		D(axClass, 'axIsInstanceOf', isInstanceOf);
		D(axClass.dPrototype, 'value', defaultValue);

		axClass[IS_AX_CLASS] = true;

		return axClass;
	}

	/**
     * Configures all the builtin Objects.
     */
	initialize() {
		const D = defineNonEnumerableProperty;

		// The basic dynamic prototype that all objects in this security domain have in common.
		const dynamicObjectPrototype = Object.create(AXBasePrototype);
		dynamicObjectPrototype.sec = this;
		// The basic traits prototype that all objects in this security domain have in common.
		Object.defineProperty(this, 'objectPrototype',
			{ value: Object.create(dynamicObjectPrototype) });
		this.initializeCoreNatives();

		// Debugging Helper
		release || (this.objectPrototype['trace'] = function trace() {
			const self = this;
			const writer = new IndentingWriter();
			this.traits.traits.forEach(t => {
				writer.writeLn(t + ': ' + self[t.getName().getMangledName()]);
			});
		});

		this.AXGlobalPrototype = Object.create(this.objectPrototype);
		this.AXGlobalPrototype.$BgtoString = function() {
			return '[object global]';
		};

		this.AXActivationPrototype = Object.create(this.objectPrototype);
		this.AXActivationPrototype.$BgtoString = function() {
			return '[Activation]';
		};

		this.AXCatchPrototype = Object.create(this.objectPrototype);
		this.AXCatchPrototype.$BgtoString = function() {
			return '[Catch]';
		};

		// The core classes' MOP hooks and dynamic prototype methods are defined
		// here to keep all the hooks initialization in one place.
		const AXObject = this.AXObject;
		const AXFunction = this.AXFunction;

		// Object(null) creates an object, and this behaves differently than:
		// (function (x: Object) { trace (x); })(null) which prints null.
		D(AXObject, 'axApply', axApplyObject);
		D(AXObject, 'axConstruct', axConstructObject);
		D(AXObject.tPrototype, 'axInitializer', axDefaultInitializer);
		D(AXObject, 'axCoerce', axCoerceObject);

		this.prepareNativeClass('AXMethodClosure', 'builtin.as$0.MethodClosure', false);
		this.prepareNativeClass('AXError', 'Error', false);

		this.prepareNativeClass('AXMath', 'Math', false);
		this.prepareNativeClass('AXDate', 'Date', false);

		this.prepareNativeClass('AXXML', 'XML', false);
		this.prepareNativeClass('AXXMLList', 'XMLList', false);
		this.prepareNativeClass('AXQName', 'QName', false);
		this.prepareNativeClass('AXNamespace', 'Namespace', false);

		const AXArray = this.prepareNativeClass('AXArray', 'Array', false);
		//D(AXArray, 'axBox', axBoxPrimitive);
		AXArray.tPrototype.$BgtoString = AXFunction.axBox(function () {
			return this.value.toString();
		});
		// Array.prototype is an Array, and behaves like one.
		AXArray.dPrototype['value'] = [];

		this.argumentsPrototype = Object.create(this.AXArray.tPrototype);
		Object.defineProperty(this.argumentsPrototype, '$Bgcallee', { get: axGetArgumentsCallee });

		const AXRegExp = this.prepareNativeClass('AXRegExp', 'RegExp', false);
		// RegExp.prototype is an (empty string matching) RegExp, and behaves like one.
		AXRegExp.dPrototype['value'] = /(?:)/;

		// Boolean, int, Number, String, and uint are primitives in AS3. We create a placeholder
		// base class to help us with instanceof tests.
		const AXPrimitiveBox = this.prepareNativeClass('AXPrimitiveBox', 'PrimitiveBox', false);
		D(AXPrimitiveBox.dPrototype, '$BgtoString',
			AXFunction.axBox(function () { return this.value.toString(); }));

		this.preparePrimitiveClass('AXBoolean', 'Boolean', axCoerceBoolean, false,
			axCoerceBoolean, axIsTypeBoolean, axIsTypeBoolean);

		this.preparePrimitiveClass('AXString', 'String', axConvertString, '',
			axCoerceString, axIsTypeString, axIsTypeString);

		this.preparePrimitiveClass('AXNumber', 'Number', axCoerceNumber, 0,
			axCoerceNumber, axIsTypeNumber, axIsTypeNumber);

		this.preparePrimitiveClass('AXInt', 'int', axCoerceInt, 0, axCoerceInt,
			axIsTypeInt, axFalse);

		this.preparePrimitiveClass('AXUint', 'uint', axCoerceUint, 0, axCoerceUint,
			axIsTypeUint, axFalse);

		// Install class loaders on the security domain.
		installClassLoaders(this.application, this);
		installNativeFunctions(this);
	}
}