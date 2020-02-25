import { ASNumber } from "./ASNumber";
import { addPrototypeFunctionAlias } from "./addPrototypeFunctionAlias";
import { defineNonEnumerableProperty } from "@awayfl/swf-loader";
import { Errors } from "../errors";

export class ASInt extends ASNumber {
    public static staticNatives: any [] = [Math];
    public static instanceNatives: any [] = [ASNumber.prototype];
  
    static classInitializer() {
      var proto: any = this.dPrototype;
      var asProto: any = ASInt.prototype;
      addPrototypeFunctionAlias(proto, '$BgtoString', asProto.toString);
      addPrototypeFunctionAlias(proto, '$BgtoLocaleString', asProto.toString);
      addPrototypeFunctionAlias(proto, '$BgvalueOf', asProto.valueOf);
  
      defineNonEnumerableProperty(this, '$BgMAX_VALUE',  0x7fffffff);
      defineNonEnumerableProperty(this, '$BgMIN_VALUE', -0x80000000);
    }
  
    toString(radix: number) {
      if (arguments.length === 0) {
        radix = 10;
      } else {
        radix = radix|0;
        if (radix < 2 || radix > 36) {
          this.sec.throwError('RangeError', Errors.InvalidRadixError, radix);
        }
      }
      if (this.axClass !== this.sec.AXNumber) {
        this.sec.throwError('TypeError', Errors.InvokeOnIncompatibleObjectError,
                                        'Number.prototype.toString');
      }
  
      return this.value.toString(radix);
    }
  
    valueOf() {
      if (this.axClass !== this.sec.AXNumber) {
        this.sec.throwError('TypeError', Errors.InvokeOnIncompatibleObjectError,
                                        'Number.prototype.valueOf');
      }
      return this.value;
    }
  }