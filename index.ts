import {
  CoercibleGraphQLInputField,
  defaultCoercer,
  CoercibleGraphQLArgument,
  coerceFieldArgumentsValues,
  pathToArray
} from "graphql-field-arguments-coercion";
import { assert } from "chai";
import {
  SchemaDirectiveVisitor,
  makeExecutableSchema,
  visitSchema,
  SchemaVisitor
} from "graphql-tools";
import { GraphQLField, defaultFieldResolver } from "graphql";
import { ApolloServer, UserInputError } from "apollo-server";

const typeDefs = `
directive @length(max: Int!) on FIELD_DEFINITION | INPUT_FIELD_DEFINITION

type Query {
  books: [Book]
}

type Book {
  title: String
}

type Mutation {
  createBook(book: BookInput): Book
}

input BookInput {
  title: String! @length(max: 10)
}`;

class LengthDirective<TContext> extends SchemaDirectiveVisitor<
  { max: number },
  TContext
> {
  visitInputFieldDefinition(
    field: CoercibleGraphQLInputField<string, TContext>
  ) {
    const { coerce } = field;
    field.coerce = async (value, ...args) => {
      // called other coercers
      if (coerce) value = await coerce(value, ...args);

      const { path } = args[1]; // inputCoerceInfo
      const { max } = this.args;

      assert.isAtMost(
        value.length,
        max,
        `${pathToArray(path).join(".")} length`
      );

      return value;
    };
  }

  visitArgumentDefinition(
    argument: CoercibleGraphQLArgument<string, TContext>
  ) {
    const { coerce = defaultCoercer } = argument;
    argument.coerce = async (value, ...args) => {
      // called other coercers
      if (coerce) value = await coerce(value, ...args);
      assert.isAtMost(value.length, this.args.max);
      return value;
    };
  }

  visitFieldDefinition(field: GraphQLField<any, any>) {
    const { resolve = defaultFieldResolver } = field;
    field.resolve = async (...args) => {
      const value = await resolve(...args);
      value && assert.isAtMost(value.length, this.args.max);
      return value;
    };
  }
}

const schema = makeExecutableSchema({
  typeDefs,
  resolvers: {
    Mutation: {
      createBook: (_, { book }) => {
        return { title: "12" };
      }
    }
  },
  schemaDirectives: {
    // @ts-ignore
    length: LengthDirective
  }
});

class FieldResoverWrapperVisitor<TContext> extends SchemaVisitor {
  visitFieldDefinition(field: GraphQLField<any, TContext>) {
    const { resolve = defaultFieldResolver } = field;
    field.resolve = async (parent, argumentValues, context, info) => {
      const coercionErrors: Error[] = [];
      const coercedArgumentValues = await coerceFieldArgumentsValues(
        field,
        argumentValues,
        context,
        info,
        (e) => coercionErrors.push(e)
      );

      if (coercionErrors.length > 0) {
        throw new UserInputError("Arguments are incorrect");
      }
      return resolve(parent, coercedArgumentValues, context, info);
    };
  }
}

visitSchema(schema, new FieldResoverWrapperVisitor());

// ----
const server = new ApolloServer({ schema });
server.listen().then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
