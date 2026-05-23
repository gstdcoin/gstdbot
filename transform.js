module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  function isLangCondition(expr) {
    if (!expr) return false;
    if (expr.type === 'BinaryExpression' && (expr.operator === '===' || expr.operator === '==')) {
      const isLeftLang = expr.left.type === 'Identifier' && ['lang', 'isRu'].includes(expr.left.name);
      const isRightLang = expr.right.type === 'Identifier' && ['lang', 'isRu'].includes(expr.right.name);
      const isLeftRu = (expr.left.type === 'StringLiteral' || expr.left.type === 'Literal') && expr.left.value === 'ru';
      const isRightRu = (expr.right.type === 'StringLiteral' || expr.right.type === 'Literal') && expr.right.value === 'ru';
      if ((isLeftLang && isRightRu) || (isRightLang && isLeftRu)) {
        return true;
      }
      
      if (expr.left.type === 'CallExpression' && expr.left.callee && expr.left.callee.property && expr.left.callee.property.name === 'detectLang' && isRightRu) {
        return true;
      }
      if (expr.left.type === 'CallExpression' && expr.left.callee && expr.left.callee.property && expr.left.callee.property.name === 'lang' && isRightRu) {
        return true;
      }
    }
    if (expr.type === 'Identifier' && expr.name === 'isRu') {
      return true;
    }
    return false;
  }

  // Handle ternary operators
  root.find(j.ConditionalExpression).forEach(path => {
    if (isLangCondition(path.node.test)) {
      j(path).replaceWith(path.node.alternate);
    }
  });

  // Handle if statements
  root.find(j.IfStatement).forEach(path => {
    if (isLangCondition(path.node.test)) {
      if (path.node.alternate) {
        // Replace the whole if statement with the contents of the else block
        j(path).replaceWith(path.node.alternate);
      } else {
         // No else block, so we just remove the if entirely
         j(path).remove();
      }
    }
  });

  return root.toSource();
};
module.exports.parser = 'ts';
