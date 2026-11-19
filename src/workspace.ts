import type {Asset,Boot,Workspace,Run} from './model'
import {DEFAULT_SETTINGS} from './model'
import {DEFAULT_CAMERA,placeImages,type BoardImage,type Point,type Rect} from './board-geometry'
import {demoStyleStore,emptyStyleStore} from './styles'

const seeds: Record<string,Pick<BoardImage,'seedGroup'|'shape'>> = {
  layout:{seedGroup:'A',shape:'tall'},
  swatches:{seedGroup:'A',shape:'square'},
  walkers:{seedGroup:'B'},
  leaves:{seedGroup:'B'},
  grain:{seedGroup:'B',shape:'tall'},
  s1:{seedGroup:'Stream'},s2:{seedGroup:'Stream'},s3:{seedGroup:'Stream'},s4:{seedGroup:'Stream'},
  h1:{seedGroup:'Hill'},h2:{seedGroup:'Hill'},h3:{seedGroup:'Hill'},
}
export function initialWorkspace(data:Boot):Workspace {
  return data.workspace ?? {
    prompt:'',settings:DEFAULT_SETTINGS,styleStore:data.demo?demoStyleStore():emptyStyleStore(),
    imageIds:data.demo?Object.keys(seeds):[],attachments:[],active:null,target:null,guideMode:'whole',
    guides:{},positions:{},camera:DEFAULT_CAMERA,annotations:[],
  }
}

export function itemsFor(w:Workspace,assets:Asset[],runs:Run[],demo:boolean) {
  const map=new Map(assets.map((a)=>[a.id,a]))
  const items:BoardImage[] = w.imageIds.flatMap((id)=>{
    const a=map.get(id)
    return a ? [{...a,...(demo?seeds[id]:undefined),hasArea:w.guides[id]?.some((g)=>g.layer==='area'&&!g.erase)}] : []
  })
  for (const run of runs) for (const c of run.candidates) {
    const a=map.get(c.id)
    if (!a) continue
    items.push({...a,name:a.name.replace(/\.png$/i,''),candidate:true,kept:c.kept,seen:c.seen,reviewStatus:c.reviewStatus,
      needsReview:c.checks.filter((x)=>x.status!=='pass'&&!x.override).length,hasArea:run.guideMode==='mask'})
  }
  return items
}

export function candidatePositions(runs:Run[],assets:Asset[],existing:Record<string,Rect>) {
  const result={...existing}
  const imageById=new Map(assets.map((a)=>[a.id,a]))
  for (const run of runs) {
    let x=run.rect.x
    for (const candidate of run.candidates) {
      const image=imageById.get(candidate.id)
      if (!image) continue
      const height=Math.max(1,run.rect.width*image.height/image.width)
      result[image.id] ??= {x,y:run.rect.y,width:run.rect.width,height}
      x += run.rect.width+6
    }
  }
  return result
}
export function importPositions(images:Asset[],point:Point,occupied:Rect[]) {
  return placeImages(images,point,occupied)
}
