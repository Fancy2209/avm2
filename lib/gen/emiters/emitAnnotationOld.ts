import { CONSTANT } from '../../abc/lazy/CONSTANT';
import { CompilerState } from '../CompilerState';
import { IFunctionAnnotation } from './emitAnnotation';
import { emitInlineLocal } from './emitInlineVars';

export function emitAnnotationOld(state: CompilerState): IFunctionAnnotation {
	const params = state.methodInfo.parameters;
	const methodName = state.methodInfo.meta.name;

	const js0 = [];
	const idnt = state.moveIndent(1);

	js0.push(`${idnt} return function compiled_${methodName.replace(/([^a-z0-9]+)/gi, '_')}() {`);

	for (let i: number = 0; i < params.length; i++)
		if (params[i].hasOptionalValue()) {
			js0.push(`${idnt} let argnum = arguments.length;`);
			break;
		}

	// eslint-disable-next-line max-len
	js0.push(`${idnt} let ${emitInlineLocal(state, 0)} = this === context.jsGlobal ? context.savedScope.global.object : this;`);

	for (let i: number = 0; i < params.length; i++) {
		const p = params[i];
		js0.push(`${idnt} let ${emitInlineLocal(state, i + 1)} = arguments[${i}];`);

		if (params[i].hasOptionalValue())
			switch (p.optionalValueKind) {
				case CONSTANT.Utf8:
					// eslint-disable-next-line max-len
					js0.push(`${idnt} if (argnum <= ${i}) ${emitInlineLocal(state, i + 1)} = context.abc.getString(${p.optionalValueIndex});`);
					break;
				default:
					js0.push(`${idnt} if (argnum <= ${i}) ${emitInlineLocal(state, i + 1)} = ${p.getOptionalValue()};`);
					break;
			}
	}

	return {
		annotation: js0.join('\n'),
		paramsShift: 0
	};
}