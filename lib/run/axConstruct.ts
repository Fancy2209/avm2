import { MovieClip, SceneImage2D, FrameScriptManager } from '@awayjs/scene';
import { AssetBase, WaveAudio } from '@awayjs/core';
import { BitmapImage2D } from '@awayjs/stage';
import { AXClass } from './AXClass';
import { Multiname } from '../abc/lazy/Multiname';
import { AXApplicationDomain } from './AXApplicationDomain';


export class ActiveLoaderContext {	
	//	ActiveLoaderContext.loaderContext is a hack !
	//	in future the appDom should be provided by the symbol
	public static loaderContext: any;
}

// todo: move OrphanManager elsewhere and add strong type
// maybe eve solve the orphan-issue in otherway alltogether
export class OrphanManager {

	static orphans: any[] = [];
	static addOrphan(orphan: any) {
		if (OrphanManager.orphans.indexOf(orphan)>=0) {
			return;
		}
		OrphanManager.orphans.push(orphan);
	}
	static removeOrphan(orphan: any) {
		if (OrphanManager.orphans.indexOf(orphan)<0) {
			return;
		}
		// todo: make this faster:
		var newOrphans = [];
		for (var i = 0; i < OrphanManager.orphans.length; i++) {
			if (OrphanManager.orphans[i] != orphan) {
				newOrphans.push(OrphanManager.orphans[i]);
			}
		}
		OrphanManager.orphans = newOrphans;
	}
	static updateOrphans() {
		for (var i = 0; i < OrphanManager.orphans.length; i++) {
			
			//if((<AwayMovieClip>OrphanManager.orphans[i].adaptee).isAsset(AwayMovieClip)){
				OrphanManager.orphans[i].adaptee.update();
			// }
			// else{
			// 	(<any>OrphanManager.orphans[i]).advanceFrame(events);

			// }
			//(<any>OrphanManager.orphans[i]).dispatchQueuedEvents();
		}
	}

}

/**
 * Generic axConstruct method that lives on the AXClass prototype. This just
 * creates an empty object with the right prototype and then calls the
 * instance initializer.
 *
 * TODO: Flatten out the argArray, or create an alternate ax helper to
 * make object construction faster.
 */
export function axConstruct(argArray?: any[]) {
	const _this = this as AXClass;

	var object = Object.create(_this.tPrototype);
	var symbol=null;
	var timeline=null;
	var classToCheck = _this;
	//  find the AwayJS-timline that should be used for this MC. might be on superclass...
	while(classToCheck && !timeline){
		symbol = (<any>classToCheck)._symbol;
		if(symbol && symbol.timeline)
			timeline = symbol.timeline;
		classToCheck = classToCheck.superClass;
	}

	if (timeline) {
		var newMC = new MovieClip(timeline);
		//console.log("create mc via axConstruct");
		object.adaptee = newMC;
		newMC.reset();
		//FrameScriptManager.execute_queue();
		//(<any>object).dispatchStaticEvent(Event.FRAME_CONSTRUCTED)
		OrphanManager.addOrphan(object);
	}


	//	ActiveLoaderContext.loaderContext is a hack !
	//	in future the appDom should be provided by the symbol

	const name = (<Multiname>_this.superClass?.classInfo?.instanceInfo?.name).name;
	const appDom = ActiveLoaderContext.loaderContext?.applicationDomain;

	if (name === "Sound") {
		let instName = (<Multiname>_this.classInfo.instanceInfo.name).name;
		let asset = appDom?.getAwayJSAudio(instName);
		
		// todo looks like we have a issue with multname and names that contain a "."
		// normally you would not expect classnames to contain a "." in the name
		// but sounds might have classnames like "sound.wav"
		// multiname splits the name and stores the first part as "uri"
		if(!asset){
			instName=(<Multiname>_this.classInfo.instanceInfo.name).uri+"."+instName;
			asset = appDom?.getAwayJSAudio(instName);
		}
		
		if (asset && (<AssetBase>asset).isAsset && (<AssetBase>asset).isAsset(WaveAudio)) {
			object.adaptee=asset;
		}
		else{
			if(appDom){
				console.log("error: could not find audio for class", instName, asset);
			}
			else{
				console.log("error: could not get audio for class", instName, "no ActiveLoaderContext.loaderContext");
			}
		}
	}
	else if (name === "BitmapData") 
	{
		let instName = (<Multiname>_this.classInfo.instanceInfo.name).name;
		let asset = appDom?.getDefinition(instName);

		if(!asset){
			instName=(<Multiname>_this.classInfo.instanceInfo.name).uri+"."+instName;
			asset = appDom?.getDefinition(instName);
		}
		if (asset && (<AssetBase>asset).isAsset && ((<AssetBase>asset).isAsset(SceneImage2D) || (<AssetBase>asset).isAsset(BitmapImage2D))) {
			object.adaptee = asset;
		}
		else {
			if(appDom){
				console.log("error: could not find bitmap for class", instName, asset);
			}
			else{
				console.log("error: could not get bitmap for class", instName, "no ActiveLoaderContext.loaderContext");
			}
		}	
	}

	if(object.adaptee && object.adaptee.timeline){
		object.adaptee.timeline.resetScripts();
	}
	FrameScriptManager.execute_as3_constructors();
	object.axInitializer.apply(object,argArray);
	if(object.initAdapter){
		object.executeConstructor=()=>{};
		object.initAdapter();
	}
	
	return object;
}
