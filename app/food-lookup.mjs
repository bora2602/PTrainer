import { searchFoodCatalog, normalizeFoodQuery } from './food-catalog.mjs';
export { normalizeFoodQuery };

const DEFAULT_USER_AGENT='Ptrainer/0.1 (https://github.com/bora2602/PTrainer)';
const API_ROOT='https://world.openfoodfacts.org/api/v3/product';
const PRODUCT_FIELDS='code,product_name,brands,serving_size,serving_quantity,nutriments';

export function normalizeBarcode(value){
  const barcode=String(value||'').replace(/[\s-]/g,'');
  return /^\d{8,14}$/.test(barcode)?barcode:null;
}

const finiteOrNull=value=>{
  const number=Number(value);
  return value==null||value===''||!Number.isFinite(number)||number<0?null:number;
};

export function normalizeOpenFoodFactsProduct(payload,requestedBarcode){
  if(payload?.status!=='success'||payload?.result?.id!=='product_found'||!payload.product)return null;
  const product=payload.product,nutrients=product.nutriments||{},barcode=normalizeBarcode(product.code)||requestedBarcode;
  const name=String(product.product_name||'Packaged food').trim().slice(0,200),brand=String(product.brands||'').trim().slice(0,200);
  const servingQuantity=finiteOrNull(product.serving_quantity);
  return{
    id:`off:${barcode}`,barcode,name,brand,
    servingSize:String(product.serving_size||'').trim().slice(0,80),
    suggestedQuantity:servingQuantity&&servingQuantity>0&&servingQuantity<=5000?servingQuantity:100,
    nutritionPer100g:{
      calories:finiteOrNull(nutrients['energy-kcal_100g']),
      proteinG:finiteOrNull(nutrients.proteins_100g),
      carbsG:finiteOrNull(nutrients.carbohydrates_100g),
      fatG:finiteOrNull(nutrients.fat_100g)
    },
    source:'OPEN_FOOD_FACTS',sourceUrl:`https://world.openfoodfacts.org/product/${barcode}`
  };
}

export async function lookupFoodProduct(barcode,{fetchImpl=fetch,userAgent=DEFAULT_USER_AGENT,timeoutMs=6000}={}){
  const normalized=normalizeBarcode(barcode);if(!normalized){const error=new Error('Enter an 8–14 digit UPC, EAN, or GTIN barcode.');error.code='BARCODE_INVALID';throw error}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`${API_ROOT}/${normalized}?fields=${PRODUCT_FIELDS}`,{headers:{'User-Agent':userAgent,'Accept':'application/json'},signal:controller.signal,redirect:'follow'});
    if(!response.ok){const error=new Error('The food database is temporarily unavailable.');error.code='FOOD_LOOKUP_UNAVAILABLE';throw error}
    return normalizeOpenFoodFactsProduct(await response.json(),normalized);
  }finally{clearTimeout(timer)}
}

// Open Food Facts is crowd-sourced, so a slice of entries carry impossible
// numbers (a hazelnut spread at 5 kcal/100 g). Drop a hit whose stated calories
// cannot be reconciled with its own macros rather than write it into a journal.
export function plausibleNutrition({calories,proteinG,carbsG,fatG}){
  if(calories==null||calories<0||calories>900)return false;
  const macros=[proteinG,carbsG,fatG];
  if(macros.some(value=>value!=null&&(value<0||value>100)))return false;
  if(macros.reduce((sum,value)=>sum+(value||0),0)>100)return false;
  if(macros.every(value=>value==null))return true;
  const derived=(proteinG||0)*4+(carbsG||0)*4+(fatG||0)*9;
  return Math.abs(derived-calories)<=Math.max(60,calories*0.45);
}

const SEARCH_ROOT='https://search.openfoodfacts.org/search';
const SEARCH_FIELDS='code,product_name,brands,serving_size,serving_quantity,nutriments';

// Search-a-licious returns brands as an array and omits fields it has no data
// for, so this cannot reuse the barcode normalizer. A hit without calories is
// useless for a journal entry, so drop it rather than show an empty row.
export function normalizeOpenFoodFactsHit(hit){
  const barcode=normalizeBarcode(hit?.code);if(!barcode)return null;
  const round=value=>{const number=finiteOrNull(value);return number==null?null:Math.round(number*10)/10};
  const nutrients=hit.nutriments||{},calories=round(nutrients['energy-kcal_100g']);if(calories==null)return null;
  const name=String(hit.product_name||'').trim().slice(0,200);if(!name)return null;
  const brand=(Array.isArray(hit.brands)?hit.brands.join(', '):String(hit.brands||'')).trim().slice(0,200);
  const servingQuantity=finiteOrNull(hit.serving_quantity);
  const product={
    id:`off:${barcode}`,barcode,name,brand,
    servingSize:String(hit.serving_size||'').trim().slice(0,80),
    suggestedQuantity:servingQuantity&&servingQuantity>0&&servingQuantity<=5000?servingQuantity:100,
    nutritionPer100g:{
      calories,
      proteinG:round(nutrients.proteins_100g),
      carbsG:round(nutrients.carbohydrates_100g),
      fatG:round(nutrients.fat_100g)
    },
    source:'OPEN_FOOD_FACTS',sourceUrl:`https://world.openfoodfacts.org/product/${barcode}`
  };
  return plausibleNutrition(product.nutritionPer100g)?product:null;
}

export async function searchOpenFoodFactsByName(query,{fetchImpl=fetch,userAgent=DEFAULT_USER_AGENT,timeoutMs=5000,limit=6}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`${SEARCH_ROOT}?q=${encodeURIComponent(query)}&page_size=${limit*2}&fields=${SEARCH_FIELDS}`,{headers:{'User-Agent':userAgent,'Accept':'application/json'},signal:controller.signal,redirect:'follow'});
    if(!response.ok)return null;
    const payload=await response.json();
    if(!Array.isArray(payload?.hits))return null;
    const seen=new Set(),results=[];
    // The same product is listed under many GTINs, so dedupe on the label the
    // trainee actually reads instead of on the barcode.
    for(const hit of payload.hits){const product=normalizeOpenFoodFactsHit(hit);if(!product)continue;const key=`${product.name.toLowerCase()}|${product.brand.toLowerCase()}|${Math.round(product.nutritionPer100g.calories)}`;if(seen.has(key))continue;seen.add(key);results.push(product);if(results.length>=limit)break}
    return results;
  }catch{return null}finally{clearTimeout(timer)}
}

// The bundled catalog answers first and always: a trainee typing a plain
// ingredient gets nutrition facts even when Open Food Facts is unreachable,
// which is what keeps the journal usable when the lookup degrades.
export async function searchFoodsByName(query,options={}){
  const normalized=normalizeFoodQuery(query);
  if(!normalized)return null;
  const catalogResults=searchFoodCatalog(normalized,options.catalogLimit??4);
  const remoteResults=await searchOpenFoodFactsByName(normalized,options);
  const seen=new Set(catalogResults.map(food=>food.id));
  const results=[...catalogResults,...(remoteResults||[]).filter(food=>!seen.has(food.id))].slice(0,options.limit??10);
  return{query:normalized,results,remoteAvailable:remoteResults!==null};
}
