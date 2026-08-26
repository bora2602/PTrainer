// Generic whole-food reference values, per 100 g/ml, rounded from public
// nutrient tables. These answer "chicken breast" or "banana" instantly and
// without a network call — Open Food Facts is packaged-product data and rarely
// has a clean entry for an unbranded ingredient. Values are coaching estimates,
// not label-accurate figures; the UI must say so.
// Row format: name|kcal|protein g|carbs g|fat g|typical serving g
const groups = {
  'Meat & fish': [
    'Chicken breast, cooked|165|31|0|3.6|120','Chicken thigh, cooked|209|26|0|10.9|120','Turkey breast, cooked|135|30|0|1|120','Lean ground beef, cooked|217|26|0|11.8|120','Beef steak, cooked|206|30|0|9|150','Pork loin, cooked|187|27|0|8|120','Bacon, cooked|541|37|1.4|42|30','Pork sausage, cooked|339|19|2.5|28|75','Deli ham|145|17|3|6.5|56','Deli turkey slices|104|17|3|2.5|56','Salmon, cooked|208|22|0|13|150','Smoked salmon|117|18|0|4.3|56','Tuna, canned in water|116|26|0|1|100','Cod, cooked|105|23|0|0.9|150','Shrimp, cooked|99|24|0.2|0.3|100'
  ],
  'Eggs, dairy & alternatives': [
    'Egg, whole|143|12.6|0.7|9.5|50','Egg white|52|11|0.7|0.2|33','Milk, whole|61|3.2|4.8|3.3|250','Milk, skim|34|3.4|5|0.2|250','Soy milk, unsweetened|54|3.3|6|1.8|240','Almond milk, unsweetened|15|0.6|0.6|1.2|240','Greek yogurt, plain nonfat|59|10|3.6|0.4|170','Yogurt, plain whole milk|61|3.5|4.7|3.3|170','Cottage cheese, 2%|84|11|4.3|2.3|226','Cheddar cheese|403|23|3.1|33|30','Mozzarella, part-skim|254|24|2.8|16|30','Feta cheese|264|14|4.1|21|30','Parmesan cheese|431|38|4.1|29|15','Cream cheese|342|6|4.1|34|30','Butter|717|0.9|0.1|81|10'
  ],
  'Plant protein': [
    'Tofu, firm|144|17|2.8|8.7|100','Tempeh|192|20|7.6|11|100','Edamame, cooked|122|11|10|5|100','Lentils, cooked|116|9|20|0.4|200','Chickpeas, cooked|164|8.9|27|2.6|160','Black beans, cooked|132|8.9|24|0.5|170','Kidney beans, cooked|127|8.7|22.8|0.5|170','Hummus|166|7.9|14|9.6|60','Whey protein powder|375|78|8|4|30'
  ],
  'Grains & starches': [
    'White rice, cooked|130|2.7|28|0.3|150','Brown rice, cooked|123|2.7|26|1|150','Pasta, cooked|158|5.8|31|0.9|150','Whole wheat pasta, cooked|124|5.3|27|0.5|150','Egg noodles, cooked|138|4.5|25|2.1|160','Quinoa, cooked|120|4.4|21|1.9|150','Couscous, cooked|112|3.8|23|0.2|150','Oats, dry|379|13|67|6.5|40','Oatmeal, cooked|71|2.5|12|1.5|240','White bread|265|9|49|3.2|30','Whole wheat bread|247|13|41|3.4|30','Bagel|250|10|49|1.5|95','Flour tortilla|306|8|51|7.7|45','Corn flakes cereal|357|7|84|0.4|30','Granola|471|10|64|20|50','Rice cake|387|8|82|2.8|9','Pancake|227|6.4|28|9.7|80','Potato, boiled|87|2|20|0.1|200','Sweet potato, baked|90|2|21|0.2|200','French fries|312|3.4|41|15|120','Sweet corn|86|3.2|19|1.2|150'
  ],
  'Fruit': [
    'Apple|52|0.3|14|0.2|180','Banana|89|1.1|23|0.3|118','Orange|47|0.9|12|0.1|130','Pear|57|0.4|15|0.1|180','Peach|39|0.9|10|0.3|150','Kiwi|61|1.1|15|0.5|75','Grapes|69|0.7|18|0.2|150','Strawberries|32|0.7|7.7|0.3|150','Blueberries|57|0.7|14|0.3|150','Watermelon|30|0.6|7.6|0.2|200','Pineapple|50|0.5|13|0.1|165','Mango|60|0.8|15|0.4|165','Avocado|160|2|8.5|14.7|100','Raisins|299|3.1|79|0.5|40','Dates|282|2.5|75|0.4|24'
  ],
  'Vegetables': [
    'Broccoli|34|2.8|7|0.4|150','Spinach|23|2.9|3.6|0.4|100','Kale|49|4.3|9|0.9|100','Lettuce|15|1.4|2.9|0.2|80','Cabbage|25|1.3|5.8|0.1|100','Cauliflower|25|1.9|5|0.3|150','Carrot|41|0.9|10|0.2|100','Tomato|18|0.9|3.9|0.2|120','Cucumber|15|0.7|3.6|0.1|120','Bell pepper|31|1|6|0.3|120','Onion|40|1.1|9.3|0.1|80','Zucchini|17|1.2|3.1|0.3|150','Mushrooms|22|3.1|3.3|0.3|100','Green beans|31|1.8|7|0.2|150','Asparagus|20|2.2|3.9|0.1|130','Green peas|81|5.4|14|0.4|150','Beets|43|1.6|10|0.2|130'
  ],
  'Nuts, seeds & oils': [
    'Almonds|579|21|22|50|28','Peanuts|567|26|16|49|28','Peanut butter|588|25|20|50|32','Walnuts|654|15|14|65|28','Cashews|553|18|30|44|28','Sunflower seeds|584|21|20|51|28','Pumpkin seeds|559|30|11|49|28','Chia seeds|486|17|42|31|15','Flaxseed|534|18|29|42|15','Olive oil|884|0|0|100|14','Coconut oil|862|0|0|100|14','Mayonnaise|680|1|0.6|75|14'
  ],
  'Prepared & extras': [
    'Cheese pizza|266|11|33|10|110','Honey|304|0.3|82|0|21','Table sugar|387|0|100|0|4','Dark chocolate, 70%|598|7.8|46|43|30','Milk chocolate|535|7.6|59|30|30','Vanilla ice cream|207|3.5|24|11|66','Ketchup|101|1.2|26|0.1|17','Soy sauce|53|8|4.9|0.1|16','Orange juice|45|0.7|10|0.2|250','Cola soft drink|42|0|10.6|0|330','Beer|43|0.5|3.6|0|355','Red wine|85|0.1|2.6|0|150','Black coffee|1|0.1|0|0|240','Unsweetened tea|1|0|0.3|0|240'
  ]
};

export const foodCatalog = Object.entries(groups).flatMap(([category, rows]) => rows.map(row => {
  const [name, calories, proteinG, carbsG, fatG, servingG] = row.split('|');
  return {
    id: `catalog:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    barcode: null, name, brand: category,
    servingSize: `typical serving ${servingG} g`,
    suggestedQuantity: Number(servingG),
    nutritionPer100g: { calories: Number(calories), proteinG: Number(proteinG), carbsG: Number(carbsG), fatG: Number(fatG) },
    source: 'PTRAINER_CATALOG', sourceUrl: null
  };
}));

export const normalizeFoodQuery = value => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length >= 2 && text.length <= 60 ? text : null;
};

const searchKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Exact name beats a prefix, which beats "every word appears somewhere" — so
// "chicken breast" lands on chicken breast, not on a chicken-flavoured extra.
function scoreFood(food, queryKey, tokens) {
  const nameKey = searchKey(food.name);
  if (nameKey === queryKey) return 100;
  if (nameKey.startsWith(`${queryKey} `) || nameKey.startsWith(`${queryKey},`)) return 85;
  if (nameKey.includes(queryKey)) return 70;
  if (tokens.every(token => nameKey.includes(token))) return 55 - Math.min(20, nameKey.length / 5);
  return 0;
}

export function searchFoodCatalog(query, limit = 6) {
  const normalized = normalizeFoodQuery(query);
  if (!normalized) return [];
  const queryKey = searchKey(normalized), tokens = queryKey.split(' ').filter(Boolean);
  if (!queryKey) return [];
  return foodCatalog
    .map(food => ({ food, score: scoreFood(food, queryKey, tokens) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit)
    .map(match => match.food);
}
