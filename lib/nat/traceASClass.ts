import { AXClass } from '../run/AXClass';
import { ASClass } from './ASClass';
import { runtimeWriter } from '../run/writers';

export function traceASClass(axClass: AXClass, asClass: ASClass) {
	runtimeWriter.enter('Class: ' + axClass.classInfo);
	runtimeWriter.enter('Traps:');
	for (const k in asClass.prototype) {
		if (k.indexOf('ax') !== 0) {
			continue;
		}
		const hasOwn = asClass.hasOwnProperty(k);
		runtimeWriter.writeLn((hasOwn ? 'Own' : 'Inherited') + ' trap: ' + k);
	}
	runtimeWriter.leave();
	runtimeWriter.leave();
}