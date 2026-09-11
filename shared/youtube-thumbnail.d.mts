import type {Project,Asset} from '../src/types';
export function thumbnailFormat(p:Pick<Project,'width'|'height'>):{width:number;height:number;ratio:string;portrait:boolean};
export function thumbnailFrames(p:Project):{asset:Asset;sourceTime:number}[];
export function thumbnailBrief(p:Project,prompt:string):string;
