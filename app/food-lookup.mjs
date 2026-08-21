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
    barcode,name,brand,
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

export async function lookupFoodProduct(barcode,{fetchImpl=fetch,userAgent='Ptrainer/0.1 (https://github.com/bora2602/PTrainer)',timeoutMs=6000}={}){
  const normalized=normalizeBarcode(barcode);if(!normalized){const error=new Error('Enter an 8–14 digit UPC, EAN, or GTIN barcode.');error.code='BARCODE_INVALID';throw error}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`${API_ROOT}/${normalized}?fields=${PRODUCT_FIELDS}`,{headers:{'User-Agent':userAgent,'Accept':'application/json'},signal:controller.signal,redirect:'follow'});
    if(!response.ok){const error=new Error('The food database is temporarily unavailable.');error.code='FOOD_LOOKUP_UNAVAILABLE';throw error}
    return normalizeOpenFoodFactsProduct(await response.json(),normalized);
  }finally{clearTimeout(timer)}
}
