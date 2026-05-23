module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Replace lang === 'ru' ? ruCode : enCode with enCode
  root.find(j.ConditionalExpression).forEach(path => {
    const test = path.node.test;
    if (test.type === 'BinaryExpression' && (test.operator === '===' || test.operator === '==')) {
      if (
        (test.left.type === 'Identifier' && ['lang', 'isRu'].includes(test.left.name) && test.right.type === 'StringLiteral' && test.right.value === 'ru') ||
        (test.right.type === 'Identifier' && ['lang', 'isRu'].includes(test.right.name) && test.left.type === 'StringLiteral' && test.left.value === 'ru') ||
        (test.left.type === 'Identifier' && test.left.name === 'isRu') ||
        (test.left.type === 'CallExpression' && test.left.callee && test.left.callee.property && test.left.callee.property.name === 'detectLang' && test.right.value === 'ru')
      ) {
        j(path).replaceWith(path.node.alternate);
      }
    }
    // Also simply check identifier test.name === 'isRu'
    if (test.type === 'Identifier' && test.name === 'isRu') {
        j(path).replaceWith(path.node.alternate);
    }
  });

  // Remove `lang === 'ru' ? ... : ` from VariableDeclarator
  // Wait, the above ConditionalExpression handles all!

  return root.toSource();
};
module.exports.parser = 'ts';
