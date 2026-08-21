export function promisify(fn) {
  return (...args) => new Promise((resolve, reject) => {
    fn(...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}
export default { promisify };
