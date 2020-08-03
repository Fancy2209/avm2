import { assert } from "@awayjs/graphics"
import { Scope } from "./run/Scope"
import { HasNext2Info } from "./run/HasNext2Info"
import { AXSecurityDomain } from "./run/AXSecurityDomain"
import { validateCall } from "./run/validateCall"
import { validateConstruct } from "./run/validateConstruct"
import { axCoerceString } from "./run/axCoerceString"
import { axCheckFilter } from "./run/axCheckFilter"
import { release } from "@awayfl/swf-loader"
import { Multiname } from "./abc/lazy/Multiname"
import { CONSTANT } from "./abc/lazy/CONSTANT"
import { MethodInfo } from "./abc/lazy/MethodInfo"
import { internNamespace } from "./abc/lazy/internNamespace";
import { AXClass, IS_AX_CLASS } from "./run/AXClass"
import { axCoerceName } from "./run/axCoerceName"
import { isNumeric, jsGlobal } from "@awayfl/swf-loader"
import { ABCFile } from "./abc/lazy/ABCFile"
import { ScriptInfo } from "./abc/lazy/ScriptInfo"
import { ExceptionInfo } from './abc/lazy/ExceptionInfo'
import { Bytecode } from './Bytecode'
import { ASObject } from './nat/ASObject'
import { InstanceInfo } from './abc/lazy/InstanceInfo'
import { ClassInfo } from './abc/lazy/ClassInfo'
import { MethodTraitInfo } from './abc/lazy/MethodTraitInfo'
import { namespaceTypeNames } from './abc/lazy/NamespaceType'
import { affilate, Instruction } from "./gen/affiliate"

import {
	ComplexGenerator, 
	PhysicsLex, 
	TopLevelLex 
} from "./gen/LexImportsGenerator";

import {
	extClassContructor, 
	getExtClassField, 
	emitIsAXOrPrimitive, 
	emitIsAX,
	IS_EXTERNAL_CLASS
} from "./ext/external";


const METHOD_HOOKS: StringMap<{path: string, place: "begin" | "return", hook: Function}> = {};

export let BytecodeName = Bytecode
/**
 * Try resolve method and attach hook to it 
 */
export function UNSAFE_attachMethodHook(
	path: string, 
	place: 'begin' | 'return' = 'begin', 
	hook: Function) {
		if(!path || typeof hook !== 'function') {
			throw "Hook path should be exits and function should be a function";
		}
	
	METHOD_HOOKS[path + "__" + place] = {
		path, place, hook
	};
}

/**
 * @description Generate safe instruction for null block usage
 */
class CallBlockSaver {
	_block: {alias: string} = null;
	_used: boolean = false;
	_needSafe: boolean = false;
	test(mn: Multiname) {
		return false;
	}

	markToSafe( mn: Multiname) {
		return this._needSafe = this.test(mn);
	}

	drop() {
		// we can drop already used block
		if(this._used) {
			return;
		}
		this._needSafe = false;
		this._block = undefined;
	}

	safe(alias: string) {
		this._block = {alias};
		this._used = false;
		return true;
	}

	needSafe(alias: string) {
		return this._needSafe && this._block && this._block.alias === alias;
	}

	beginSafeBlock(alias: string) {
		if(!this.needSafe(alias)) {
			return "";
		}

		this._used = true;
		return `if(${this._block.alias} != undefined) {`; // push block end;
	}

	endSafeBlock(fallback?: string) {
		if(!this._used) {
			return "";
		}
		
		const result = fallback ? `} else { ${this._block.alias} = ${fallback}; }` : "}";

		this._used = false;
		this._block = undefined;
		return result;
	}
}

class TweenCallSaver extends CallBlockSaver {
	test(mn: Multiname) {
		return mn.namespaces && mn.namespace?.uri && mn.namespace.uri.includes("TweenLite");
	}	
}

export const enum OPT_FLAGS {
	USE_ES_PARAMS = 1, // use es7 style of compiled function to avoid use arguments
	USE_NEW_FUCTION = 2, // use eval instead of new Function
	SKIP_NULL_COERCE = 4, // skip coerce for nulled constant objects
	SKIP_DOMAIN_MEM = 8, // skip compilation of domain memory instructions
	ALLOW_CUSTOM_OPTIMISER = 16 // allow use custom optimiser classe for mutate codegenerator
}

const DEFAULT_OPT = 
	OPT_FLAGS.ALLOW_CUSTOM_OPTIMISER |
	OPT_FLAGS.USE_NEW_FUCTION | 
	OPT_FLAGS.USE_ES_PARAMS | 
	OPT_FLAGS.SKIP_NULL_COERCE | 
	OPT_FLAGS.SKIP_DOMAIN_MEM;

// allow set to plain object in setproperty when it not AXClass
const UNSAFE_SET = false;
// allow unsafe calls and property gets from objects
const UNSAFE_JIT = false;

let SCRIPT_ID = 0;

const CLASS_NAME_METHOD_NAME: StringMap<number> = {};

export interface ICompilerProcess {
	error?: string;
	source?: string;
	compiling?: Promise<Function> | undefined;
	compiled?: Function;
	names?: Multiname[];
}

export function compile(methodInfo: MethodInfo, optimise: OPT_FLAGS = DEFAULT_OPT): ICompilerProcess {

	// lex generator
	const lexGen = new ComplexGenerator([
		new PhysicsLex({box2D: false}), // generate static aliases for Physics engine
		new TopLevelLex() // generate alias for TopLevel props
	]);
	const blockSaver = new TweenCallSaver();

	// kill cache when instruction set a far that this
	const SAFE_INS_DIST = 4;
	const fastCall = undefined;/* =  
	{
		_active: {},
		mark(stackAlias: string, mangled: boolean, index: number) {
			this._active[stackAlias] = {mangled, index};
		},
		sureThatFast(stackAlias: string): any {
			return this._active[stackAlias];
		},
		kill(stackAlias: string,) {
			delete this._active[stackAlias];
		},
		killFar(index: number) {
			const keys = Object.keys(this._active);
			for(let k of keys) {
				if(index - this._active[k].index >= SAFE_INS_DIST) {
					delete this._active[k];	
				}
			}
		}
	}*/
	
	const USE_OPT = (opt) => {
		return optimise & OPT_FLAGS.ALLOW_CUSTOM_OPTIMISER && !!opt;
	}

	const {
		error,
		jumps,
		catchStart,
		catchEnd,
		set : q
	} = affilate(methodInfo);

	// if affilate a generate error, broadcast it
	if(error) {
		return {error};
	}
	
	const prefix = ("" + (SCRIPT_ID++)).padLeft("0", 4);
	const funcName = (methodInfo.getName()).replace(/([^a-z0-9]+)/gi, "_");
	
	let fullPath = `__root__/${prefix}_${funcName || 'unknown'}`;
	let path = fullPath;
	let methodName = funcName;
	let isMemeber = true;
	let methodType = "Public";
	let superClass = undefined;

	if(methodInfo.trait) {
		if(methodInfo.trait.holder instanceof ClassInfo) {
			path =  methodInfo.trait.holder.instanceInfo.getClassName().replace(/\./g, "/");
			isMemeber = false;
		}
		else if(methodInfo.trait.holder instanceof InstanceInfo) {
			path = methodInfo.trait.holder.getClassName().replace(/\./g, "/");
			superClass =  methodInfo.trait.holder.getSuperName()?.
									toFQNString(false).replace(/\./g, "/");;
		}
		if(methodInfo.trait instanceof MethodTraitInfo ){
			methodName = (<Multiname>methodInfo.trait.name).name;
			methodType = namespaceTypeNames[(<Multiname>methodInfo.trait.name).namespace.type];
		}

		if(methodInfo.isConstructor) {
			//constructor
			methodName = 'constructor';
		} else {
			// member
			methodName  = isMemeber ?  ("m_" + methodName) : methodName;
		}

		fullPath = path + "/" + methodName;
	
		if(CLASS_NAME_METHOD_NAME[fullPath] !== undefined) {
			const index = CLASS_NAME_METHOD_NAME[fullPath] = CLASS_NAME_METHOD_NAME[fullPath] + 1;
			fullPath += "$" + index;			
		} else {
			CLASS_NAME_METHOD_NAME[fullPath] = 0;
		}
	}

	// for instances
	if(methodInfo.instanceInfo) {
		path = methodInfo.instanceInfo.getClassName().replace(/\./g, "/");
		methodName = methodInfo.isConstructor ? 'constructor' : funcName;
		superClass = methodInfo.instanceInfo.getSuperName()?.
									toFQNString(false).replace(/\./g, "/");
		fullPath = path + "/" + methodName;
	}

	const hookMethodPath = `${path}${isMemeber ? "::" : "."}${methodName}`
	const scriptHeader = 
`/*
	Index: ${methodInfo.index()}
	Path:  ${hookMethodPath}
	Type:  ${methodType}
	Super: ${superClass || '-'}
*/\n\n`

	const abc = methodInfo.abc;
	const body = methodInfo.getBody();
	const maxstack = body.maxStack;
	const maxlocal = body.localCount - 1;
	const maxscope = body.maxScopeDepth - body.initScopeDepth;


	let js0 = [];
	let js = [];

	let idnt: string = "";
	let idnLen = 0;
	// move correr by 4 spaces - 1, for separate idnt =)
	const moveIdnt = (offset: number) => {
		idnLen += offset * 4;
		if(idnLen < 0) idnLen = 0;

		return idnt = (" ").repeat( idnLen ? idnLen - 1 : 0);
	}
	
	let openTryCatchBlockGroups: ExceptionInfo[][] = [];
	//	creates a catch condition for a list of ExceptionInfo
	let createCatchConditions = (catchBlocks: ExceptionInfo[]) => {
		let createFinally:string[]=[];
		js.push(`${idnt} catch(e){`);

		moveIdnt(1);

		js.push(`${idnt} // in case this is a error coming from stack0.__fast when stack0 is undefined,`);
		js.push(`${idnt} // we convert it to a ASError, so that avm2 can still catch it`);
		js.push(`${idnt} if (e instanceof TypeError)`);
		js.push(`${idnt}     e=context.sec.createError("TypeError", {code:1065, message:e.message})`);
		js.push(`${idnt} stack0 = e;`);

		for (var i = 0; i < catchBlocks.length; i++) {
			var typeName = catchBlocks[i].getType();
			if (!typeName) {
				js.push(`${idnt} { p = ${catchBlocks[i].target}; continue; };`);
				//if(!catchBlocks[i].varName)
				//createFinally.push(`{ p = ${catchBlocks[i].target}; continue; };`);
				continue;
			}
			else {
				let n = names.indexOf(typeName)
				if (n < 0) {
					n = names.length
					names.push(typeName)
					js0.push(`    let name${n} = context.names[${n}];`)
				}
				js.push(`${idnt} const errorClass$${i} = context.sec.application.getClass(name${n});`);
				js.push(`${idnt} if(errorClass$${i} && errorClass$${i}.axIsType(e))`);
				js.push(`${idnt}     { p = ${catchBlocks[i].target}; continue; };`);
			}
		}
		// if error was not catched by now, we throw it
		js.push(`${idnt} throw e;`);
		
		moveIdnt(-1);

		js.push(`${idnt} }`);
		/*for (var i = 0; i < createFinally.length; i++) {
			js.push(`            ${indent}${createFinally[i]}`);
		}*/
	}
	//	closes all try-catch blocks. used when entering a new case-block
	let closeAllTryCatch = () => {
		//js.push(`//CLOSE ALL`);
	
		for (let i = 0; i < openTryCatchBlockGroups.length; i++) {
			moveIdnt(-1);
			js.push(`${idnt} }`);
			createCatchConditions(openTryCatchBlockGroups[i]);
		}
	}
	//	reopen all try-catch blocks. used when entering a new case-block
	let openAllTryCatch = () => {
		for (let i = 0; i < openTryCatchBlockGroups.length; i++) {
			js.push(`${idnt} try {`);
			moveIdnt(1);
		}
	}

	let temp = false
	let domMem = false;
	for (let q_i of q) {
		let b = q_i.name;

		if (b == Bytecode.NEWOBJECT || b == Bytecode.SWAP || b == Bytecode.HASNEXT2) {
			temp = true
		}

		domMem = domMem || (b >= Bytecode.LI8 && b <= Bytecode.SF64);
	}

	let params = methodInfo.parameters

	const underrun = "[stack underrun]";
	let paramsShift = 0;

	if(optimise & OPT_FLAGS.USE_ES_PARAMS) {
		const args = [];		
		
		for (let i = 0; i < params.length; i++) {
			let p = params[i];
			let arg = "local" + (i + 1);

			if (p.hasOptionalValue()){
				switch (p.optionalValueKind) {
					case CONSTANT.Utf8:
						arg += ` = ${JSON.stringify(abc.getString(p.optionalValueIndex))}`;
						break
					default:
						arg += ` = ${p.getOptionalValue()}`
				}
			}

			args.push(arg);
		}

		if(methodInfo.needsRest()) {
			args.push("...args");
		}

		js0.push(`return function compiled_${methodName}(${args.join(', ')}) {`);

		moveIdnt(1);

		js0.push(`${idnt} let local0 = this === context.jsGlobal ? context.savedScope.global.object : this;`)

		if(methodInfo.needsRest()) {
			js0.push(`${idnt} let local${params.length + 1} = context.sec.createArrayUnsafe(args);`);
			paramsShift += 1;
		}

		if(methodInfo.needsArguments()) {
			js0.push(`${idnt} let local${params.length + 1} = context.sec.createArrayUnsafe(Array.from(arguments));`);
			paramsShift += 1;
		}
	} 
	else 
	{	
		js0.push("return function compiled_" + methodName + "() {")

		for (let i: number = 0; i < params.length; i++)
			if (params[i].hasOptionalValue()) {
				js0.push(`${idnt} let argnum = arguments.length;`)
				break
			}

		js0.push(`${idnt} let local0 = this === context.jsGlobal ? context.savedScope.global.object : this;`)

		for (let i: number = 0; i < params.length; i++) {
			let p = params[i]
			js0.push(`${idnt} let local${(i + 1)} = arguments[${i}];`)

			if (params[i].hasOptionalValue())
				switch (p.optionalValueKind) {
					case CONSTANT.Utf8:
						js0.push(`${idnt} if (argnum <= ${i}) local${(i + 1)} = context.abc.getString(${p.optionalValueIndex});`)
						break
					default:
						js0.push(`${idnt} if (argnum <= ${i}) local${(i + 1)} = ${p.getOptionalValue()};`)
						break
				}
		}
	}

	const LOCALS_POS = js0.length;
	// hack 
	js0.push("__PLACE__FOR__OPTIONAL__LOCALS__");

	const optionalLocalVars: Array<{index: number, die: boolean, read: number, write: 0, isArgumentList: boolean}> = [];

	for (let i: number = params.length + 1 + paramsShift; i <= maxlocal; i++) {
		optionalLocalVars[i] = {
			index: i,
			isArgumentList: i === params.length + 1,
			read: 0,
			write: 0,
			die: false,
		};
		//js0.push(`    let local${i} = ${((i == params.length + 1) ? "context.createArrayUnsafe(Array.from(arguments))" : "undefined")};`);
	}

	for (let i = 0; i < maxstack; i++)
		js0.push(`${idnt} let stack${i} = undefined;`)

	for (let i: number = 0; i < maxscope; i++)
		js0.push(`${idnt} let scope${i} = undefined;`)

	if (temp)
		js0.push(`${idnt} let temp = undefined;`)

	if (domMem)
		js0.push(`${idnt} let domainMemory; // domainMemory`);
	
	js0.push(`${idnt} let tr = undefined;`)

	let names: Multiname[] = []

	let getname = (n: number) => {
		let mn = abc.getMultiname(n)
		let i = names.indexOf(mn)
		if (i < 0) {
			i = names.length
			names.push(mn)
			js0.push(`    let name${i} = context.names[${i}];`)
		}
		return "name" + i
	}


	js0.push(`${idnt} let sec = context.sec;`)

	const genBrancher = jumps.length > 1 || catchStart;

	if(METHOD_HOOKS && METHOD_HOOKS[hookMethodPath + "__begin"]) {
		js.push(`${idnt} /* ATTACH METHOD HOOK */`)
		js.push(`${idnt} context.executeHook(local0, '${hookMethodPath + "__begin"}')`)	
	}
	js.push(`${idnt} `)
	if(genBrancher) {
		js.push(`${idnt} let p = 0;`)
		js.push(`${idnt} while (true) {`)
		js.push(`${moveIdnt(1)} switch (p) {`)
	}

	let currentCatchBlocks: ExceptionInfo[];
	let lastZ: Instruction;
	let z: Instruction;

	// case + case int
	genBrancher && moveIdnt(2);
	
	for (let i: number = 0; i < q.length; i++) {
		z && (lastZ = z);
		z = q[i];
		USE_OPT(fastCall) && fastCall.killFar(i);

		if (jumps.indexOf(z.position) >= 0) {
			// if we are in any try-catch-blocks, we must close them
			if (openTryCatchBlockGroups) closeAllTryCatch();

			if(USE_OPT(blockSaver)) {
				blockSaver.drop();
			}

			if(genBrancher) {
				moveIdnt(-1);		
				js.push(`${idnt} case ${z.position}:`);
				moveIdnt(1);
			}
			// now we reopen all the try-catch again 
			if (openTryCatchBlockGroups) openAllTryCatch();
		}

		currentCatchBlocks = catchStart ? catchStart[z.position] : null;
		if (currentCatchBlocks) {
			openTryCatchBlockGroups.push(currentCatchBlocks);

			js.push(`${idnt} try {`);
			moveIdnt(1);
		}

		js.push(`${idnt} //${BytecodeName[z.name]} ${z.params.join(" / ")} -> ${z.returnTypeId}`);// + " pos: " + z.position+ " scope:"+z.scope+ " stack:"+z.stack)

		let stackF = (n: number) => ((z.stack - 1 - n) >= 0) ? (`stack${(z.stack - 1 - n)}`) : `/*${underrun} ${z.stack - 1 - n}*/ stack0`;
		let stack0 = stackF(0)
		let stack1 = stackF(1)
		let stack2 = stackF(2)
		let stack3 = stackF(3)
		let stackN = stackF(-1)

		let scope = z.scope > 0 ? `scope${(z.scope - 1)}` : "context.savedScope"
		let scopeN = "scope" + z.scope

		let local = (n: number) => "local" + n

		let param = (n: number) => z.params[n]
		if (z.stack < 0) {
			js.push(`${idnt} // unreachable`)
		}
		else {
			let localIndex = 0;
			switch (z.name) {
				case Bytecode.LABEL:
					break
				case Bytecode.DXNSLATE:
					js.push(`${idnt} ${scope}.defaultNamespace = context.internNamespace(0, ${stack0});`)
					break
				case Bytecode.DEBUGFILE:
					break
				case Bytecode.DEBUGLINE:
					break
				case Bytecode.DEBUG:
					break
				case Bytecode.THROW:
					break
				case Bytecode.GETLOCAL:
					localIndex = param(0);
					optionalLocalVars[localIndex] && (optionalLocalVars[localIndex].read ++);

					js.push(`${idnt} ${stackN} = ${local(localIndex)};`)
					break
				case Bytecode.SETLOCAL:
					localIndex = param(0);
					
					if(optionalLocalVars[localIndex]){
						optionalLocalVars[localIndex].write ++;

						if(!optionalLocalVars[localIndex].read) {
							optionalLocalVars[localIndex].die = true;
						}
					}

					js.push(`${idnt} ${local(localIndex)} = ${stack0};`)
					break

				case Bytecode.GETSLOT:
					// slots can be get/set only on AX objects
					js.push(`${idnt} ${stack0} = ${stack0}.axGetSlot(${param(0)});`)
					break
				case Bytecode.SETSLOT:
					js.push(`${idnt} ${stack1}.axSetSlot(${param(0)}, ${stack0});`)
					break

				case Bytecode.GETGLOBALSCOPE:
					js.push(`${idnt} ${stackN} = context.savedScope.global.object;`)
					break
				case Bytecode.PUSHSCOPE:
					// extends can be used only on AXObject
					js.push(`${idnt} ${scopeN} = ${scope}.extend(${stack0});`)
					break
				case Bytecode.PUSHWITH:
					js.push(`${idnt} ${scopeN} = context.pushwith(${scope}, ${stack0});`)
					break
				case Bytecode.POPSCOPE:
					js.push(`${idnt} ${scope} = undefined;`)
					break
				case Bytecode.GETSCOPEOBJECT:
					js.push(`${idnt} ${stackN} = scope${param(0)}.object;`)
					break

				case Bytecode.NEXTNAME:
					js.push(`${idnt} ${stack1} = sec.box(${stack1}).axNextName(${stack0});`)
					break
				case Bytecode.NEXTVALUE:
					js.push(`${idnt} ${stack1} = sec.box(${stack1}).axNextValue(${stack0});`)
					break
				case Bytecode.HASNEXT:
					js.push(`${idnt} ${stack1} = sec.box(${stack1}).axNextNameIndex(${stack0});`)
					break
				case Bytecode.HASNEXT2:
					js.push(`${idnt} temp = context.hasnext2(${local(param(0))}, ${local(param(1))});`)
					js.push(`${idnt} ${local(param(0))} = temp[0];`)
					js.push(`${idnt} ${local(param(1))} = temp[1];`)
					js.push(`${idnt} ${stackN} = ${local(param(1))} > 0;`)
					break
				case Bytecode.IN:
					js.push(`${idnt} ${stack1} = (${stack1} && ${stack1}.axClass === sec.AXQName) ? obj.axHasProperty(${stack1}.name) : ${stack0}.axHasPublicProperty(${stack1});`)
					break

				case Bytecode.DUP:
					js.push(`${idnt} ${stackN} = ${stack0};`)
					break
				case Bytecode.POP:
					js.push(`${idnt};`)
					break
				case Bytecode.SWAP:
					js.push(`${idnt} temp = ${stack0};`)
					js.push(`${idnt} ${stack0} = ${stack1};`)
					js.push(`${idnt} ${stack1} = temp;`)
					js.push(`${idnt} temp = undefined;`)
					break
				case Bytecode.PUSHTRUE:
					js.push(`${idnt} ${stackN} = true;`)
					break
				case Bytecode.PUSHFALSE:
					js.push(`${idnt} ${stackN} = false;`)
					break
				case Bytecode.PUSHBYTE:
					js.push(`${idnt} ${stackN} = ${param(0)};`)
					break
				case Bytecode.PUSHSHORT:
					js.push(`${idnt} ${stackN} = ${param(0)};`)
					break
				case Bytecode.PUSHINT:
					js.push(`${idnt} ${stackN} = ${abc.ints[param(0)]};`)
					break
				case Bytecode.PUSHUINT:
					js.push(`${idnt} ${stackN} = ${abc.uints[param(0)]};`)
					break
				case Bytecode.PUSHDOUBLE:
					js.push(`${idnt} ${stackN} = ${abc.doubles[param(0)]};`)
					break
				case Bytecode.PUSHSTRING:
					js.push(`${idnt} ${stackN} = ${JSON.stringify(abc.getString(param(0)))};`)
					break
				case Bytecode.PUSHNAN:
					js.push(`${idnt} ${stackN} = NaN;`)
					break
				case Bytecode.PUSHNULL:
					js.push(`${idnt} ${stackN} = null;`)
					break
				case Bytecode.PUSHUNDEFINED:
					js.push(`${idnt} ${stackN} = undefined;`)
					break
				case Bytecode.IFEQ:
					js.push(`${idnt} if (${stack0} == ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFNE:
					js.push(`${idnt} if (${stack0} != ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFSTRICTEQ:
					js.push(`${idnt} if (${stack0} === ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFSTRICTNE:
					js.push(`${idnt} if (${stack0} !== ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFGT:
					js.push(`${idnt} if (${stack0} < ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFGE:
					js.push(`${idnt} if (${stack0} <= ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFLT:
					js.push(`${idnt} if (${stack0} > ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFLE:
					js.push(`${idnt} if (${stack0} >= ${stack1}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFFALSE:
					js.push(`${idnt} if (!${stack0}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.IFTRUE:
					js.push(`${idnt} if (${stack0}) { p = ${param(0)}; continue; };`)
					break
				case Bytecode.LOOKUPSWITCH:
					var jj = z.params.concat()
					var dj = jj.shift()
					js.push(`${idnt} if (${stack0} >= 0 && ${stack0} < ${jj.length}) { p = [${jj.join(", ")}][${stack0}]; continue; } else { p = ${dj}; continue; };`)
					break
				case Bytecode.JUMP:
					js.push(`${idnt} { p = ${param(0)}; continue; };`)
					break
				case Bytecode.INCREMENT:
					js.push(`${idnt} ${stack0}++;`)
					break
				case Bytecode.DECREMENT:
					js.push(`${idnt} ${stack0}--;`)
					break
				case Bytecode.INCLOCAL:
					js.push(`${idnt} ${local(param(0))}++;`)
					break
				case Bytecode.DECLOCAL:
					js.push(`${idnt} ${local(param(0))}--;`)
					break
				case Bytecode.INCREMENT_I:
					js.push(`${idnt} ${stack0} |= 0;`)
					js.push(`${idnt} ${stack0}++;`)
					break
				case Bytecode.DECREMENT_I:
					js.push(`${idnt} ${stack0} |= 0;`)
					js.push(`${idnt} ${stack0}--;`)
					break
				case Bytecode.INCLOCAL_I:
					js.push(`${idnt} ${local(param(0))} |= 0;`)
					js.push(`${idnt} ${local(param(0))}++;`)
					break
				case Bytecode.DECLOCAL_I:
					js.push(`${idnt} ${local(param(0))} |= 0;`)
					js.push(`${idnt} ${local(param(0))}--;`)
					break;
				case Bytecode.NEGATE_I:
					js.push(`${idnt} ${stack0} = -(${stack0} | 0);`)
					break
				case Bytecode.ADD_I:
					js.push(`${idnt} ${stack1} = (${stack1} | 0) + (${stack0} | 0);`)
					break
				case Bytecode.SUBTRACT_I:
					js.push(`${idnt} ${stack1} = (${stack1} | 0) - (${stack0} | 0);`)
					break
				case Bytecode.MULTIPLY_I:
					js.push(`${idnt} ${stack1} = (${stack1} | 0) * (${stack0} | 0);`)
					break
				case Bytecode.ADD:
					js.push(`${idnt} ${stack1} += ${stack0};`)
					break
				case Bytecode.SUBTRACT:
					js.push(`${idnt} ${stack1} -= ${stack0};`)
					break
				case Bytecode.MULTIPLY:
					js.push(`${idnt} ${stack1} *= ${stack0};`)
					break
				case Bytecode.DIVIDE:
					js.push(`${idnt} ${stack1} /= ${stack0};`)
					break
				case Bytecode.MODULO:
					js.push(`${idnt} ${stack1} %= ${stack0};`)
					break

				case Bytecode.LSHIFT:
					js.push(`${idnt} ${stack1} <<= ${stack0};`)
					break
				case Bytecode.RSHIFT:
					js.push(`${idnt} ${stack1} >>= ${stack0};`)
					break
				case Bytecode.URSHIFT:
					js.push(`${idnt} ${stack1} >>>= ${stack0};`)
					break

				case Bytecode.BITAND:
					js.push(`${idnt} ${stack1} &= ${stack0};`)
					break
				case Bytecode.BITOR:
					js.push(`${idnt} ${stack1} |= ${stack0};`)
					break
				case Bytecode.BITXOR:
					js.push(`${idnt} ${stack1} ^= ${stack0};`)
					break

				case Bytecode.EQUALS:
					js.push(`${idnt} ${stack1} = ${stack1} == ${stack0};`)
					break
				case Bytecode.STRICTEQUALS:
					js.push(`${idnt} ${stack1} = ${stack1} === ${stack0};`)
					break
				case Bytecode.GREATERTHAN:
					js.push(`${idnt} ${stack1} = ${stack1} > ${stack0};`)
					break
				case Bytecode.GREATEREQUALS:
					js.push(`${idnt} ${stack1} = ${stack1} >= ${stack0};`)
					break
				case Bytecode.LESSTHAN:
					js.push(`${idnt} ${stack1} = ${stack1} < ${stack0};`)
					break
				case Bytecode.LESSEQUALS:
					js.push(`${idnt} ${stack1} = ${stack1} <= ${stack0};`)
					break
				case Bytecode.NOT:
					js.push(`${idnt} ${stack0} = !${stack0};`)
					break
				case Bytecode.BITNOT:
					js.push(`${idnt} ${stack0} = ~${stack0};`)
					break
				case Bytecode.NEGATE:
					js.push(`${idnt} ${stack0} = -${stack0};`)
					break
				case Bytecode.TYPEOF:
					js.push(`${idnt} ${stack0} = typeof ${stack0} === 'undefined' ? 'undefined' : context.typeof(${stack0});`)
					break;
				case Bytecode.INSTANCEOF:
					js.push(`${idnt} ${stack1} = ${stack0}.axIsInstanceOf(${stack1});`)
					break
				case Bytecode.ISTYPE:
					js.push(`${idnt} ${stack0} = ${scope}.getScopeProperty(${getname(param(0))}, true, false).axIsType(${stack0});`)

					break
			case Bytecode.ISTYPELATE:
					js.push(`${idnt} ${stack1} = ${stack0}.axIsType(${stack1});`)
					break
				case Bytecode.ASTYPE:
					js.push(`${idnt} ${stack0} = ${scope}.getScopeProperty(${getname(param(0))}, true, false).axAsType(${stack0});`)
					break;

				case Bytecode.ASTYPELATE:
					js.push(`${idnt} ${stack1} = ${emitIsAXOrPrimitive(stack1)} ? ${stack0}.axAsType(${stack1}) : ${stack1};`)
					break

				case Bytecode.CALL: {
					let pp = [];
					let obj = stackF(param(0) + 1);
					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))
					
					if(USE_OPT(blockSaver) && blockSaver.safe(obj)) {
						js.push(`${idnt} /* This call maybe a safe, ${blockSaver.constructor.name} */`)
					}
					js.push(`${idnt} ${obj} = context.call(${stackF(param(0) + 1)}, ${stackF(param(0))}, [${pp.join(", ")}]);`)
				}
					break
				case Bytecode.CONSTRUCT: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} ${stackF(param(0))} = context.construct(${stackF(param(0))}, [${pp.join(", ")}]);`)
				}
					break
				case Bytecode.CALLPROPERTY:
					var mn = abc.getMultiname(param(1));
					let pp = []
					for (let j: number = 0; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					let obj = pp.shift();
					if (abc.getMultiname(param(1)).name == "getDefinitionByName") {
						js.push(`${idnt} ${stackF(param(0))} = context.getdefinitionbyname(${scope}, ${obj}, [${pp.join(", ")}]);`)
					}
					else {
						if(USE_OPT(fastCall) && fastCall.sureThatFast(`${obj}`)) 
						{
							const n = fastCall.sureThatFast(`${obj}`).mangled ? Multiname.getPublicMangledName(mn.name) : mn.name;
							fastCall.kill(`${obj}`);

							js.push(`${idnt} /* We sure that this safe call */ `)
							js.push(`${idnt} ${stackF(param(0))} = ${obj}['${n}'](${pp.join(", ")});`)

							break;
						}

						js.push(`${idnt} if (!${emitIsAXOrPrimitive(obj)}) {`)
						// fast instruction already binded
						js.push(`${idnt}    ${stackF(param(0))} = ${obj}['${mn.name}'](${pp.join(", ")});`)
						js.push(`${idnt} } else {`)
						js.push(`${idnt}    // ${mn}`)
						js.push(`${idnt}    temp = ${obj}[AX_CLASS_SYMBOL] ? ${obj} : sec.box(${obj});`)
						js.push(`${idnt}    ${stackF(param(0))} = (typeof temp['$Bg${mn.name}'] === 'function')? temp['$Bg${mn.name}'](${pp.join(", ")}) : temp.axCallProperty(${getname(param(1))}, [${pp.join(", ")}], false);`)
						js.push(`${idnt} }`)
					}
					break
				case Bytecode.CALLPROPLEX: {
					var mn = abc.getMultiname(param(1));
					let pp = []

					for (let j: number = 0; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} temp = sec.box(${pp.shift()});`)
					js.push(`${idnt} ${stackF(param(0))} = (typeof temp['$Bg${mn.name}'] === 'function')? temp['$Bg${mn.name}'](${pp.join(", ")}) : temp.axCallProperty(${getname(param(1))}, [${pp.join(", ")}], true);`)
				}
					break
				case Bytecode.CALLPROPVOID: {
					var mn = abc.getMultiname(param(1));
					let pp = [];

					for (let j: number = 0; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					let obj = pp.shift();

					if(USE_OPT(fastCall) && fastCall.sureThatFast(`${obj}`)) 
					{
						const n = fastCall.sureThatFast(`${obj}`) ? Multiname.getPublicMangledName(mn.name) : mn.name;

						js.push(`${idnt} /* We sure that this safe call */ `)
						js.push(`${idnt} ${obj}['${n}'](${pp.join(", ")});`)

						fastCall.kill(`${obj}`);
						break;
					}

					js.push(`${idnt} if (!${emitIsAXOrPrimitive(obj)}) {`)
					js.push(`${idnt}     ${obj}['${mn.name}'](${pp.join(", ")});`)
					js.push(`${idnt} } else {`)
					js.push(`${idnt}     temp = ${obj}[AX_CLASS_SYMBOL] ? ${obj} : sec.box(${obj});`)
					js.push(`${idnt}     (typeof temp['$Bg${mn.name}'] === 'function')? temp['$Bg${mn.name}'](${pp.join(", ")}) : temp.axCallProperty(${getname(param(1))}, [${pp.join(", ")}], false);`)
					js.push(`${idnt} }`)
				}
					break
				case Bytecode.APPLYTYPE: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} ${stackF(param(0))} = sec.applyType(${stackF(param(0))}, [${pp.join(", ")}]);`)
				}
					break


				case Bytecode.FINDPROPSTRICT:
					var mn = abc.getMultiname(param(0));
					js.push(`${idnt} // ${mn}`)

					if(USE_OPT(lexGen) && lexGen.test(mn)) {
						js.push(`${idnt} /* GenerateLexImports */`);
						js.push(`${idnt} ${stackN} = ${lexGen.getPropStrictAlias(mn,<any>{nameAlias: getname(param(0))})};`)

						if(USE_OPT(fastCall)) {
							const mangled = (lexGen.getGenerator(mn) instanceof TopLevelLex);
							fastCall.mark(`${stackN}`, mangled, i);
						}
						break;
					}

					js.push(`${idnt} ${stackN} = ${scope}.findScopeProperty(${getname(param(0))}, true, false);`)
					break
				case Bytecode.FINDPROPERTY:
					js.push(`${idnt} // ${abc.getMultiname(param(0))}`)
					js.push(`${idnt} ${stackN} = ${scope}.findScopeProperty(${getname(param(0))}, false, false);`)
					break
				case Bytecode.NEWFUNCTION:
					js.push(`${idnt} // ${abc.getMethodInfo(param(0))}`)
					js.push(`${idnt} ${stackN} = sec.createFunction(context.abc.getMethodInfo(${param(0)}), ${scope}, true);`)
					break
				case Bytecode.NEWCLASS:
					js.push(`${idnt} // ${abc.classes[param(0)]}`)
					js.push(`${idnt} ${stack0} = sec.createClass(context.abc.classes[${param(0)}], ${stack0}, ${scope});`)
					break
				case Bytecode.NEWARRAY: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} ${stackF(param(0) - 1)} = sec.AXArray.axBox([${pp.join(", ")}]);`)
				}
					break
				case Bytecode.NEWOBJECT:
					js.push(`${idnt} temp = Object.create(sec.AXObject.tPrototype);`)

					for (let j: number = 1; j <= param(0); j++) {
						js.push(`${idnt} temp.axSetPublicProperty(${stackF(2 * param(0) - 2 * j + 1)}, ${stackF(2 * param(0) - 2 * j)});`)
					}

					js.push(`${idnt} ${stackF(2 * param(0) - 1)} = temp;`)
					js.push(`${idnt} temp = undefined;`)

					break
				case Bytecode.NEWACTIVATION:
					js.push(`${idnt} ${stackN} = sec.createActivation(context.mi, ${scope});`)
					break
				case Bytecode.NEWCATCH:
					js.push(`${idnt} ${stackN} = sec.createCatch(context.mi.getBody().catchBlocks[${param(0)}], ${scope});`)
					break
				case Bytecode.CONSTRUCTSUPER: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} context.savedScope.superConstructor.call(${stackF(param(0))}, ${pp.join(", ")});`)
				}
					break
				case Bytecode.CALLSUPER: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} ${stackF(param(0))} = sec.box(${stackF(param(0))}).axCallSuper(${getname(param(1))}, context.savedScope, [${pp.join(", ")}]);`)
				}
					break
				case Bytecode.CALLSUPER_DYN: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					var mn = abc.getMultiname(param(1));
					if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} ${stackF(param(0) + 2)} = sec.box(${stackF(param(0) + 2)}).axGetSuper(context.runtimename(${getname(param(1))}, ${stackF(param(0))}, ${stackF(param(0) + 1)}), context.savedScope, [${pp.join(", ")}]);`)
					} else {
						js.push(`${idnt} ${stackF(param(0) + 1)} = sec.box(${stackF(param(0) + 1)}).axGetSuper(context.runtimename(${getname(param(1))}, ${stackF(param(0))}), context.savedScope, [${pp.join(", ")}]);`)
					}
				}
					break
				case Bytecode.CALLSUPERVOID: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} sec.box(${stackF(param(0))}).axCallSuper(${getname(param(1))}, context.savedScope, [${pp.join(", ")}]);`)
				}
					break
				case Bytecode.CONSTRUCTPROP: {
					let pp = []

					for (let j: number = 1; j <= param(0); j++)
						pp.push(stackF(param(0) - j))

					js.push(`${idnt} ${stackF(param(0))} = context.constructprop(${getname(param(1))}, ${stackF(param(0))}, [${pp.join(", ")}]);`)

					USE_OPT(fastCall) && fastCall.kill(stackF(param(0)));
				}
					break
				case Bytecode.GETPROPERTY:
					var mn = abc.getMultiname(param(0));
					let isSafe = false;
					let lastIdnt = idnt;

					if(USE_OPT(blockSaver) && blockSaver.needSafe(stack0)) {
						isSafe = true;

						js.push(`${idnt} ${blockSaver.beginSafeBlock(stack0)}`);
						
						moveIdnt(1);
					}

					if(USE_OPT(fastCall) && fastCall.sureThatFast(stack0)) 
					{
						const n = fastCall.sureThatFast(stack0).mangled ? Multiname.getPublicMangledName(mn.name) : mn.name;
						fastCall.kill(stack0);

						js.push(`${idnt} /* We sure that this safe call */ `)
						js.push(`${idnt} ${stack0} = ${stack0}['${n}'];`)

						break;
					}
					
					js.push(`${idnt} // ${mn}`)
					js.push(`${idnt} if (!${emitIsAX(stack0)}) {`)
					js.push(`${idnt}     ${stack0} = ${stack0}['${mn.name}'];`)
					js.push(`${idnt} } else {`)
					js.push(`${idnt}     temp = ${stack0}[AX_CLASS_SYMBOL] ? ${stack0} : sec.box(${stack0});`)
					js.push(`${idnt}     ${stack0} = temp['$Bg${mn.name}'];`)
					js.push(`${idnt}     if (${stack0} === undefined || typeof ${stack0} === 'function') {`)
					js.push(`${idnt}         ${stack0} = temp.axGetProperty(${getname(param(0))});`)
					js.push(`${idnt}     }`)
					js.push(`${idnt} }`)

					if(isSafe) {
						moveIdnt(-1);
						js.push(`${idnt} ${blockSaver.endSafeBlock('undefined')}`);
					}

					break
				case Bytecode.GETPROPERTY_DYN:
					var mn = abc.getMultiname(param(0));
					
					if(USE_OPT(blockSaver) && blockSaver.markToSafe(mn)) {
						js.push(`${idnt} /* Mark lookup to safe call, ${blockSaver.constructor.name} */`)
					}

					js.push(`${idnt} // ${mn}`);
					if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} ${stack2} = context.getpropertydyn(context.runtimename(${getname(param(0))}, ${stack0}, ${stack1}), ${stack2});`)
					} else {
						js.push(`${idnt} ${stack1} = context.getpropertydyn(context.runtimename(${getname(param(0))}, ${stack0}), ${stack1});`)
					}
					break
				case Bytecode.SETPROPERTY:
					var mn = abc.getMultiname(param(0))
					js.push(`${idnt} // ${mn}`)
					js.push(`${idnt} if (!${emitIsAX(stack1)}){`)
					js.push(`${idnt}     ${stack1}['${mn.name}'] = ${stack0};`)
					js.push(`${idnt} } else {`)
					js.push(`${idnt}     context.setproperty(${getname(param(0))}, ${stack0}, ${stack1});`)
					js.push(`${idnt} }`)
					break
				case Bytecode.SETPROPERTY_DYN:
                    var mn = abc.getMultiname(param(0));
                    if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} context.setproperty(context.runtimename(${getname(param(0))}, ${stack1}, ${stack2}), ${stack0}, ${stack3});`)
					} else {
						js.push(`${idnt} context.setproperty(context.runtimename(${getname(param(0))}, ${stack1}), ${stack0}, ${stack2});`)
					}
					break
				case Bytecode.DELETEPROPERTY:
					js.push(`${idnt} // ${abc.getMultiname(param(0))}`)
					js.push(`${idnt} ${stack0} = context.deleteproperty(${getname(param(0))}, ${stack0});`)
					break
				case Bytecode.DELETEPROPERTY_DYN:
                    var mn = abc.getMultiname(param(0));
					if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} ${stack2} = context.deleteproperty(context.runtimename(${getname(param(0))}, ${stack0}, ${stack1}), ${stack2});`)
					} else {
						js.push(`${idnt} ${stack1} = context.deleteproperty(context.runtimename(${getname(param(0))}, ${stack0}), ${stack1});`)
					}
					break
				case Bytecode.GETSUPER:
					js.push(`${idnt} ${stack0} = sec.box(${stack0}).axGetSuper(${getname(param(0))}, context.savedScope);`)
					break
				case Bytecode.GETSUPER_DYN:
					var mn = abc.getMultiname(param(0));
					if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} ${stack2} = sec.box(${stack2}).axGetSuper(context.runtimename(${getname(param(0))}, ${stack0}, ${stack1}), context.savedScope);`)
					} else {
						js.push(`${idnt} ${stack1} = sec.box(${stack1}).axGetSuper(context.runtimename(${getname(param(0))}, ${stack0}), context.savedScope);`)
					}
					break
				case Bytecode.SETSUPER:
					js.push(`${idnt} sec.box(${stack1}).axSetSuper(${getname(param(0))}, context.savedScope, ${stack0});`)
					break
				case Bytecode.SETSUPER_DYN:
					var mn = abc.getMultiname(param(0));
					if (mn.isRuntimeName() && mn.isRuntimeNamespace()) {
						js.push(`${idnt} sec.box(${stack3}).axSetSuper(context.runtimename(${getname(param(0))}, ${stack1}, ${stack2}), context.savedScope, ${stack0});`)
					} else {
						js.push(`${idnt} sec.box(${stack2}).axSetSuper(context.runtimename(${getname(param(0))}, ${stack1}), context.savedScope, ${stack0});`)
					}
					break
				case Bytecode.GETLEX:
					var mn = abc.getMultiname(param(0));

					if(USE_OPT(lexGen) && lexGen.test(mn)) {
						js.push(`${idnt} // ${mn}`)
						js.push(`${idnt} /* GenerateLexImports */`);
						js.push(`${idnt} ${stackN} = ${lexGen.getLexAlias(mn,<any>{nameAlias : getname(param(0))})};`);

						if(fastCall) {
							const mangled = (lexGen.getGenerator(mn) instanceof TopLevelLex);
							fastCall.mark(`${stackN}`, mangled, i);
						}

					} else {
						js.push(`${idnt} // ${mn}`)
						js.push(`${idnt} temp = ${scope}.findScopeProperty(${getname(param(0))}, true, false);`)
						js.push(`${idnt} ${stackN} = temp['$Bg${mn.name}'];`)
						js.push(`${idnt} if (${stackN} === undefined || typeof ${stackN} === 'function') {`)
						js.push(`${idnt}     ${stackN} = temp.axGetProperty(${getname(param(0))});`)
						js.push(`${idnt} }`)
					}
					break
				case Bytecode.RETURNVALUE:
					if(METHOD_HOOKS && METHOD_HOOKS[hookMethodPath + "__return"]) {
						js.push(`${idnt} /* ATTACH METHOD HOOK */`)
						js.push(`${idnt} context.executeHook(local0, '${hookMethodPath + "__return"}')`)	
					}
					js.push(`${idnt} return ${stack0};`)
					break
				case Bytecode.RETURNVOID:
					if(METHOD_HOOKS && METHOD_HOOKS[hookMethodPath + "__return"]) {
						js.push(`${idnt} /* ATTACH METHOD HOOK */`)
						js.push(`${idnt} context.executeHook(local0, '${hookMethodPath + "__return"}')`)	
					}

					js.push(`${idnt} return;`)
					break
				case Bytecode.COERCE:
					if(optimise & OPT_FLAGS.SKIP_NULL_COERCE && (lastZ.name === Bytecode.PUSHNULL || lastZ.name === Bytecode.PUSHUNDEFINED)) {
						js.push(`${idnt} // SKIP_NULL_COERCE`);
						break;
					}
					js.push(`${idnt} ${stack0} = ${emitIsAX(stack0)} ? ${scope}.getScopeProperty(${getname(param(0))}, true, false).axCoerce(${stack0}): ${stack0};`)
					break
				case Bytecode.COERCE_A:
					js.push(`${idnt} ;`)
					break
				case Bytecode.COERCE_S:
					if(optimise & OPT_FLAGS.SKIP_NULL_COERCE && (lastZ.name === Bytecode.PUSHNULL || lastZ.name === Bytecode.PUSHUNDEFINED)) {
						js.push(`${idnt} // SKIP_NULL_COERCE`);
						break;
					}
					js.push(`${idnt} ${stack0} = context.axCoerceString(${stack0});`)
					break
				case Bytecode.CONVERT_I:
					js.push(`${idnt} ${stack0} |= 0;`)
					break
				case Bytecode.CONVERT_D:
					js.push(`${idnt} ${stack0} = +${stack0};`)
					break
				case Bytecode.CONVERT_B:
					js.push(`${idnt} ${stack0} = !!${stack0};`)
					break
				case Bytecode.CONVERT_U:
					js.push(`${idnt} ${stack0} >>>= 0;`)
					break
				case Bytecode.CONVERT_S:
					js.push(`${idnt} if (typeof ${stack0} !== 'string') ${stack0} = ${stack0} + '';`)
					break
				case Bytecode.CONVERT_O:
					js.push(`${idnt} ;`)
					break
				case Bytecode.CHECKFILTER:
					js.push(`${idnt} ${stack0} = context.axCheckFilter(sec, ${stack0});`)
					break
				case Bytecode.KILL:
					js.push(`${idnt} ${local(param(0))} = undefined;`)
					break
	
				default:
					if(!(optimise & OPT_FLAGS.SKIP_DOMAIN_MEM)) {
						switch(z.name){
								//http://docs.redtamarin.com/0.4.1T124/avm2/intrinsics/memory/package.html#si32()
							case Bytecode.SI8:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} domainMemory.setInt8(${stack0}, ${stack1})`);
								break;
							case Bytecode.SI16:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} domainMemory.setInt16(${stack0}, ${stack1}, true);`);
								break;
							case Bytecode.SI32:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} domainMemory.setInt32(${stack0}, ${stack1}, true);`);
								break;
							case Bytecode.SF32:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} domainMemory.setFloat32(${stack0}, ${stack1}, true);`);
								break;
							case Bytecode.SF64:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} domainMemory.setFloat64(${stack0}, ${stack1}, true);`);
								break;

							//http://docs.redtamarin.com/0.4.1T124/avm2/intrinsics/memory/package.html#li32()
							case Bytecode.LI8:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} ${stack0} = domainMemory.getInt8(${stack0})`);
								break;
							case Bytecode.LI16:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} ${stack0} = getInt16(${stack0}, true);`);
								break;
							case Bytecode.LI32:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} ${stack0} = domainMemory.getInt32(${stack0}, true);`);
								break;
							case Bytecode.LF32:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} ${stack0} = domainMemory.getFloat32(${stack0}, true);`);
								break;
							case Bytecode.LF64:
								js.push(`${idnt} domainMemory = domainMemory || context.domainMemory;`);
								js.push(`${idnt} ${stack0} = domainMemory.getFloat64(${stack0}, true);`);
								break;
						}
					} 

					if((z.name <= Bytecode.LI8 && z.name >= Bytecode.SF64)) {
						js.push(`${idnt} //unknown instruction ${BytecodeName[q[i].name]}`)
						//console.log(`unknown instruction ${BytecodeName[q[i].name]} (method N${methodInfo.index()})`)
						return { error: "unhandled instruction " + z }
					}
			}
		}

		currentCatchBlocks = catchEnd ? catchEnd[z.position] : null;
		if (currentCatchBlocks) {
			var lastCatchBlocks = openTryCatchBlockGroups.pop();
			if (lastCatchBlocks) {
				moveIdnt(-1);

				js.push(`${idnt}}`)
				createCatchConditions(lastCatchBlocks);
			}

		}
	}
	if(openTryCatchBlockGroups.length>0){		
		var lastCatchBlocks = openTryCatchBlockGroups.pop();
		if (lastCatchBlocks) {
			moveIdnt(-1);

			js.push(`${idnt}}`)
			createCatchConditions(lastCatchBlocks);
		}
	}

	if(genBrancher) {
		// close switch
		js.push(`${moveIdnt(-1)} }`)
		// close while
		js.push(`${moveIdnt(-1)} }`)
	}
	js.push(`${moveIdnt(-1)} }`)

	// Debugging magic 
	// https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Debug_eval_sources

	js.push(`//# sourceURL=http://jit/${fullPath}.js`)

	const locals = [];

	for(let l of optionalLocalVars) {
		if(!l) {
			continue;
		}

		if(l.die) {
			locals.push(`     // local${l.index} is assigned before read, skip init`)
		}
		// todo: this is not 100% correct yet:
		locals.push(`    let local${l.index} =  undefined`);
		if(!(optimise & OPT_FLAGS.USE_ES_PARAMS)) {
			if(l.index==params.length+1 && !l.die){
				locals.push(`    if(arguments && arguments.length) { local${l.index} = context.sec.createArrayUnsafe(Array.from(arguments).slice(${params.length})); }`);
				locals.push(`    else { local${l.index} = context.emptyArray; }`);
			}
		}
	}

	js0[LOCALS_POS] = locals.join("\n");

	const header = ["const AX_CLASS_SYMBOL = context.AX_CLASS_SYMBOL;"];
	
	if(USE_OPT(lexGen)) {
		header.push(lexGen.genHeader());
	}

	let w = scriptHeader + header.join("\n") +  js0.join("\n") + "\n" + js.join("\n");
	const hasError = w.indexOf(underrun) > -1;

	let compiled;
	if (!(optimise & OPT_FLAGS.USE_NEW_FUCTION)) {
		w = "(function(context) {\n" + w + "\n})";
		compiled = eval(w);

	} else {
		compiled = new Function("context", w);
	}

	let underrunLine = -1;

	if(hasError) {
		underrunLine = w.split("\n").findIndex(v => v.indexOf(underrun) >= 0) + 3;
	}
	return {
		names: names,
		compiled,
		error : hasError ? `STACK UNDERRUN at http://jit/${prefix}_${funcName || 'unknown'}.js:${underrunLine}` : undefined
	};
}

export class Context {
	private readonly mi: MethodInfo;
	private readonly savedScope: Scope;
	private readonly rn:Multiname;
	private readonly sec: AXSecurityDomain
	private readonly abc: ABCFile
	private readonly names: Multiname[]
	private readonly jsGlobal: Object = jsGlobal;
	private readonly axCoerceString: Function = axCoerceString;
	private readonly axCheckFilter: Function = axCheckFilter;
	private readonly internNamespace: Function = internNamespace;
	private domain: any;
	private domainMemoryView: DataView;

	public readonly emptyArray: any;
	public readonly AX_CLASS_SYMBOL = IS_AX_CLASS;

	constructor(mi: MethodInfo, savedScope: Scope, names: Multiname[]) {
		this.mi = mi;
		this.savedScope = savedScope;
		this.rn = new Multiname(mi.abc, 0, null, null, null, null, true);
		this.abc = mi.abc;
		this.sec = mi.abc.applicationDomain.sec;
		this.names = names;
		this.emptyArray = Object.create(this.sec.AXArray.tPrototype);
		this.emptyArray.value = [];
	}

	get domainMemory(): DataView {
		if(!this.domain) {
			this.domain = (<any>this.sec).flash.system.ApplicationDomain.axClass.currentDomain;
			
			if(!this.domain) {
				console.warn("[JIT] Try access to domainMemory on unresolved ApplicationDomain!");
				return null;
			}
		}

		return this.domain.internal_memoryView;
	}
	/**
	 * Execute JS hoo
	 */
	executeHook(context: any, name: string) {
		let hook = METHOD_HOOKS[name];
		if(hook) {
			hook.hook(context);
		}
	}

	/**
	* Generate static import for builtins
	*/
	getTopLevel(mnId: number, name?: string): any {
		const prop = this.savedScope.findScopeProperty(this.names[mnId], true, false);

		if(name) {
			return prop[name];
		}
		return prop;
	}

	/**
	 * Generate static import of object
	 */
	getStaticImportExt(namespace: string, name: string = undefined): any {
		return getExtClassField(name, namespace);
	}

	typeof(object: any): string {
		const type = typeof object;
		const sec = this.sec;

		switch(type) {
			case 'boolean':
				return 'Boolean';
			case 'object':
				if(object === null) {
					return 'object';
				}

				if(sec.AXXMLList.dPrototype.isPrototypeOf(object) || sec.AXXML.dPrototype.isPrototypeOf(object)) {
					return 'xml';
				}

				if(sec.AXNumber.dPrototype.isPrototypeOf(object)) {
					return 'number';
				}

				if(sec.AXBoolean.dPrototype.isPrototypeOf(object)) {
					// what???. 
					return 'Boolean';
				}

				if(sec.AXString.dPrototype.isPrototypeOf(object)) {
					return 'string';
				}
		}

		return type;
	}

	call(value, obj, pp): any {
		validateCall(this.sec, value, pp.length)
		return value.axApply(obj, pp)
	}

	getdefinitionbyname(scope, obj, pp) {
		return (<ScriptInfo>(<any>scope.global.object).scriptInfo).abc.env.app.getClass(Multiname.FromSimpleName(pp[0]))
	}

	getpropertydyn(mn, obj) {
		let b = this.sec.box(obj)

		if (typeof mn === "number")
			return b.axGetNumericProperty(mn)

		let temp = b['$Bg' + mn.name];

		if (temp != undefined && typeof temp !== 'function')
			return temp;

		return b.axGetProperty(mn)
	}

	setproperty(mn: Multiname, value: any, obj: AXClass) {

		// unsfae SET fro plain Objects
		if(!obj[IS_AX_CLASS]) {
			obj[mn.name] = value;
			return;
		}

		if (typeof mn === "number"){
			return obj.axSetNumericProperty(mn, value)
		}

		// Hubrid
		// Mom is Human, Dad is Marsian
		// and it not has a axSetProp
		if(obj[IS_EXTERNAL_CLASS]) {
			// create prop and proxy to JS side.
			ASObject.prototype.axSetProperty.call(obj, mn, value, <any>Bytecode.INITPROPERTY);
			Object.defineProperty(obj, mn.name, {value});
			return;
		}

		obj.axSetProperty(mn, value, <any>Bytecode.INITPROPERTY)
	}

	deleteproperty(name, obj) {
		let b = this.sec.box(obj);
		if (typeof name === "number" || typeof name === "string")
			return delete b[name];
		return b.axDeleteProperty(name)
	}

	construct(obj, pp) {
		let mn = obj.classInfo.instanceInfo.getName()

		let r = extClassContructor(mn.name, pp)

		if (r != null)
			return r

		// if (mn.name.indexOf("b2") >= 0)
		//     console.log("*B2: " + mn.name)

		validateConstruct(this.sec, obj, pp.length)
		return obj.axConstruct(pp)
	}


	constructprop(mn: Multiname, obj, pp) {
		let r = extClassContructor(mn, pp)

		if (r != null)
			return r

		// if (mn.name.indexOf("b2") >= 0)
		//     console.log("B2: " + mn.name)

		let b = this.sec.box(obj)
		let name = b.axResolveMultiname(mn)
		let ctor = b[name]

		validateConstruct(b.sec, ctor, pp.length)
		return ctor.axConstruct(pp)
	}


	pushwith(scope, obj) {
		let b = this.sec.box(obj)
		return (scope.object === b && scope.isWith == true) ? scope : new Scope(scope, b, true)
	}


	hasnext2(obj, name) {
		let info = new HasNext2Info(null, 0)
		info.next(this.sec.box(obj), name)
		return [info.object, info.index]
	}

	runtimename(mn, stack0, stack1) {
        this.rn.resolved = {}
        this.rn.script = null  
        this.rn.numeric = false
        this.rn.id = mn.id;
        this.rn.kind = mn.kind;
        if (mn.isRuntimeName()) {
            var name = stack0;
            // Unwrap content script-created AXQName instances.
            if (name && name.axClass && name.axClass === name.sec.AXQName) {
              name = name.name;
              release || assert(name instanceof Multiname);
              this.rn.kind = mn.isAttribute() ? CONSTANT.RTQNameLA : CONSTANT.RTQNameL;
              this.rn.id = name.id;
              this.rn.name = name.name;
              this.rn.namespaces = name.namespaces;
              return this.rn;
            }
          	// appriory number
			if (typeof name === 'number') {
				this.rn.numeric = true;
				this.rn.numericValue = name;
			} else {
				const coerce = axCoerceName(name);

				if(isNumeric(coerce)) {
					this.rn.numeric = true;
					this.rn.numericValue = +coerce;	
				}
			}

            this.rn.name = name;
            this.rn.id = -1;
          } else {
            this.rn.name = mn.name;
            stack1 = stack0
          }
          if (mn.isRuntimeNamespace()) {
            var ns = stack1;
            // Unwrap content script-created AXNamespace instances.
            if (ns._ns) {
              release || assert(ns.sec && ns.axClass === ns.sec.AXNamespace);
              ns = ns._ns;
            }
            this.rn.namespaces = [ns];
            this.rn.id = -1;
          } else {
            this.rn.namespaces = mn.namespaces;
          }

		return this.rn
	}
}
