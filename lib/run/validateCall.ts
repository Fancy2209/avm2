import { Errors } from '../errors';
import { AXSecurityDomain } from './AXSecurityDomain';
import { AXCallable } from './AXCallable';

export function validateCall(sec: AXSecurityDomain, fun: AXCallable, argc: number) {
	if (!fun || !fun.axApply) {
		sec.throwError('TypeError', Errors.CallOfNonFunctionError,
			fun && fun.methodInfo ? fun.methodInfo.name : 'value');
	}
	if (fun.methodInfo && argc < fun.methodInfo.minArgs) {
		sec.throwError('ArgumentError', Errors.WrongArgumentCountError, fun.methodInfo.name,
			fun.methodInfo.minArgs, argc);
	}
}